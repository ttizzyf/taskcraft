import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import type { HostAdapter, Verdict } from "./types.ts";

export const JOB_PROTOCOL = "tc-eval/job-v1" as const;
export const JOB_RESULT_FILE = "result.json";

export interface JobWorkerRequest {
  protocol: typeof JOB_PROTOCOL;
  jobId: string;
  caseId: string;
  repetition: number;
  attempt: number;
  attemptDir: string;
  cliPath: string;
  repoRoot: string;
  host: HostAdapter;
  model: string | null;
  judgeModel: string | null;
  actorTimeoutMs: number;
  judgeTimeoutMs: number;
}

export interface JobReportPaths {
  jsonPath: string;
  markdownPath: string;
}

export interface JobResultPayload {
  protocol: typeof JOB_PROTOCOL;
  jobId: string;
  attempt: number;
  status: "finished" | "error";
  verdict: Verdict | null;
  report: JobReportPaths | null;
  diagnostics: string[];
}

export type JobProcessResult =
  | { kind: "result"; payload: JobResultPayload }
  | { kind: "crashed"; diagnostics: string[] }
  | { kind: "cancelled"; diagnostics: string[] };

export interface JobProcessHandle {
  pid: number | null;
  result: Promise<JobProcessResult>;
  cancel(): void;
}

const JOB_TERMINATION_GRACE_MS = 2_000;

/** Starts one job in its own detached process group. The batch controller can
 * therefore stop a worker without sharing a signal boundary with siblings. */
export function spawnEvalJob(
  request: JobWorkerRequest,
  workerPath = defaultWorkerPath(),
): JobProcessHandle {
  const child = spawn(process.execPath, [workerPath], {
    cwd: request.attemptDir,
    shell: false,
    detached: true,
    env: {
      ...process.env,
      PATH: `${join(request.attemptDir, "bin")}:${process.env.PATH ?? ""}`,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pid = child.pid ?? null;
  let cancelled = false;
  let settled = false;
  let stdout = "";
  let stderr = "";
  let spawnError: string | null = null;
  let forceKillTimer: NodeJS.Timeout | undefined;

  const result = new Promise<JobProcessResult>((resolveResult) => {
    const finish = (exitCode: number | null, signal: string | null): void => {
      if (settled) return;
      settled = true;
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      const diagnostics = [] as string[];
      if (spawnError !== null) diagnostics.push(spawnError);
      if (stderr.trim() !== "") diagnostics.push(`stderr: ${truncate(stderr)}`);
      const payload = parseJobResult(stdout);
      if (cancelled) {
        diagnostics.push("job process cancelled by batch controller");
        resolveResult({
          kind: "cancelled",
          diagnostics: diagnostics.slice(0, 8),
        });
        return;
      }
      if (exitCode !== 0 || payload === null) {
        if (exitCode !== null && exitCode !== 0) {
          diagnostics.push(
            `job worker exited with ${signal === null ? `code ${String(exitCode)}` : signal}`,
          );
        }
        if (payload === null)
          diagnostics.push("job worker emitted no valid protocol result");
        resolveResult({
          kind: "crashed",
          diagnostics: diagnostics.slice(0, 8),
        });
        return;
      }
      resolveResult({ kind: "result", payload });
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      spawnError = `job worker spawn failed: ${describe(error)}`;
      finish(null, null);
    });
    child.on("close", (exitCode, signal) => {
      finish(exitCode, signal);
    });
    child.stdin?.on("error", (error: Error) => {
      spawnError = `job worker stdin failed: ${describe(error)}`;
    });
    child.stdin?.end(`${JSON.stringify(request)}\n`);
  });

  return {
    pid,
    result,
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      if (pid !== null) {
        killProcessTree(pid, "SIGTERM");
        forceKillTimer = setTimeout(() => {
          if (!settled) killProcessTree(pid, "SIGKILL");
        }, JOB_TERMINATION_GRACE_MS);
        forceKillTimer.unref();
      }
    },
  };
}

export function parseJobResult(output: string): JobResultPayload | null {
  for (const line of output.split("\n").toReversed()) {
    const text = line.trim();
    if (text === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(value) || value.protocol !== JOB_PROTOCOL) continue;
    const attempt = value.attempt;
    const verdict = value.verdict;
    const report = value.report;
    if (
      typeof value.jobId !== "string" ||
      typeof attempt !== "number" ||
      !Number.isSafeInteger(attempt) ||
      attempt <= 0 ||
      (value.status !== "finished" && value.status !== "error")
    ) {
      return null;
    }
    if (verdict !== null && !isVerdict(verdict)) return null;
    if (report !== null && !isReportPaths(report)) return null;
    if (
      !Array.isArray(value.diagnostics) ||
      !value.diagnostics.every(isString)
    ) {
      return null;
    }
    return {
      protocol: JOB_PROTOCOL,
      jobId: value.jobId,
      attempt,
      status: value.status,
      verdict,
      report,
      diagnostics: value.diagnostics,
    };
  }
  return null;
}

export function readJobResult(attemptDir: string): JobResultPayload | null {
  try {
    if (!existsSync(join(attemptDir, JOB_RESULT_FILE))) return null;
    return parseJobResult(
      readFileSync(join(attemptDir, JOB_RESULT_FILE), "utf8"),
    );
  } catch {
    return null;
  }
}

/** Kills the worker and descendants, including detached host groups that are
 * no longer in the worker's process group. `ps` is used only to observe the
 * local process tree; no model or external agent command is involved. */
export function killProcessTree(pid: number, signal: NodeJS.Signals): void {
  if (pid <= 0) return;
  const descendants = processDescendants(pid);
  for (const descendant of descendants.toReversed()) {
    try {
      process.kill(descendant, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        // The caller cannot report a synchronous kill failure without hiding
        // the original cancellation path; the worker's close is authoritative.
      }
    }
  }
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ESRCH" &&
      pid !== process.pid
    ) {
      try {
        process.kill(pid, signal);
      } catch {
        // The process may have exited between the tree snapshot and signal.
      }
    }
  }
}

export function isProcessAlive(pid: number | null): boolean {
  if (pid === null || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function stopProcessTree(
  pid: number | null,
  graceMs = JOB_TERMINATION_GRACE_MS,
): Promise<void> {
  if (pid === null || pid === process.pid) return;
  if (!isProcessAlive(pid)) return;
  killProcessTree(pid as number, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await sleep(25);
  }
  if (isProcessAlive(pid)) killProcessTree(pid as number, "SIGKILL");
}

function processDescendants(rootPid: number): number[] {
  let output: string;
  try {
    output = execFileSync("ps", ["-axo", "pid=,ppid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const children = new Map<number, number[]>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (match === null) continue;
    const pid = Number(match[1]);
    const parent = Number(match[2]);
    const list = children.get(parent) ?? [];
    list.push(pid);
    children.set(parent, list);
  }
  const found: number[] = [];
  const queue = [...(children.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const child = queue.shift();
    if (child === undefined) continue;
    found.push(child);
    queue.push(...(children.get(child) ?? []));
  }
  return found;
}

function defaultWorkerPath(): string {
  return (
    process.env.TASKCRAFT_EVAL_JOB_WORKER ??
    fileURLToPath(new URL("./job-worker.ts", import.meta.url))
  );
}

function isReportPaths(value: unknown): value is JobReportPaths {
  return (
    isRecord(value) &&
    typeof value.jsonPath === "string" &&
    value.jsonPath.trim() !== "" &&
    typeof value.markdownPath === "string" &&
    value.markdownPath.trim() !== ""
  );
}

function isVerdict(value: unknown): value is Verdict {
  return value === "pass" || value === "fail" || value === "inconclusive";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, limit = 600): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}
