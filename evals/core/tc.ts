import { spawn } from "node:child_process";

import type { CliExecution, TaskReadResult, TaskSnapshot } from "./types.ts";

const COMMAND_TIMEOUT_MS = 20_000;

export function runTcCommand(
  cliPath: string,
  cwd: string,
  args: readonly string[],
  input?: string,
): Promise<CliExecution> {
  return runProcess(process.execPath, [cliPath, ...args], cwd, input);
}

export function readTaskSnapshot(
  cliPath: string,
  cwd: string,
  taskId: string,
): Promise<TaskReadResult> {
  return runTcCommand(cliPath, cwd, ["task", "show", taskId, "--json"]).then(
    (result) => {
      if (result.status !== 0) {
        return {
          snapshot: null,
          error: truncate(result.stderr || "tc task show failed"),
        };
      }

      try {
        const envelope = JSON.parse(result.stdout) as unknown;
        if (!isRecord(envelope) || envelope.ok !== true) {
          return {
            snapshot: null,
            error: "tc task show returned invalid JSON",
          };
        }
        const data = envelope.data;
        if (!isRecord(data) || typeof data.taskId !== "string") {
          return { snapshot: null, error: "tc task show omitted task data" };
        }
        return { snapshot: normalizeTaskSnapshot(data), error: null };
      } catch (error) {
        return {
          snapshot: null,
          error: `tc task show JSON parse failed: ${describe(error)}`,
        };
      }
    },
  );
}

function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  input?: string,
): Promise<CliExecution> {
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2_000).unref();
    }, COMMAND_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status: null,
        stdout,
        stderr: `${stderr}${describe(error)}`,
        elapsedMs: Date.now() - started,
      });
    });
    child.on("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status,
        stdout,
        stderr,
        elapsedMs: Date.now() - started,
      });
    });

    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

function normalizeTaskSnapshot(data: Record<string, unknown>): TaskSnapshot {
  const snapshot: TaskSnapshot = {
    taskId: data.taskId as string,
    status: typeof data.status === "string" ? data.status : "unknown",
    taskRevision:
      typeof data.taskRevision === "number" ? data.taskRevision : -1,
    attempts: arrayOfRecords(data.attempts),
    evidence: arrayOfRecords(data.evidence),
    facts: arrayOfRecords(data.facts),
  };
  if (Array.isArray(data.findings)) {
    snapshot.findings = arrayOfRecords(data.findings);
  }
  if (Object.hasOwn(data, "nodeBrief")) {
    snapshot.nodeBrief =
      data.nodeBrief === null ? null : recordOrNull(data.nodeBrief);
  }
  return snapshot;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, limit = 600): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}
