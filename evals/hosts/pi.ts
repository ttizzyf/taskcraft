import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { HostRun, HostRunRequest } from "../core/types.ts";

export const PI_EVAL_PROVIDER = "company";
export const PI_EVAL_MODEL_ID = "gpt-5.6-luna";
export const PI_EVAL_MODEL = `${PI_EVAL_PROVIDER}/${PI_EVAL_MODEL_ID}:max`;
export const PI_EVAL_THINKING_LEVEL = "max";

const DEFAULT_POLL_MS = 250;
const TERMINATION_GRACE_MS = 2_000;
const WORKER_OVERRIDE_ENV = "TASKCRAFT_EVAL_PI_WORKER";

export interface PiModelRequest {
  provider: typeof PI_EVAL_PROVIDER;
  modelId: typeof PI_EVAL_MODEL_ID;
  thinkingLevel: typeof PI_EVAL_THINKING_LEVEL;
  requested: string;
}

export interface PiWireRequest {
  provider: typeof PI_EVAL_PROVIDER;
  modelId: typeof PI_EVAL_MODEL_ID;
  thinkingLevel: typeof PI_EVAL_THINKING_LEVEL;
  tools: string[];
  jsonSchema?: string;
}

export interface PiWireObserved {
  provider: string | null;
  model: string | null;
  api: string | null;
  providerThinkingLevel: string | null;
  sessionThinkingLevel?: string | null;
  stopReason: string | null;
  usage: Record<string, unknown> | null;
}

export interface PiWireResult {
  protocol: "tc-eval/pi-v1";
  status: "success" | "error";
  resultText: string | null;
  callCount: number | null;
  hostVersion: string | null;
  request: PiWireRequest;
  observed: PiWireObserved;
  diagnostics: string[];
  error?: string;
}

/** Accepts the explicit provider/model[:thinking] notation used by Evals.
 * The Pi adapter intentionally rejects other targets so a real run cannot
 * silently drift from the requested company Luna/max condition. */
export function parsePiModel(value?: string): PiModelRequest {
  const requested = value?.trim() || PI_EVAL_MODEL;
  const match = /^([^/]+)\/([^:]+)(?::([A-Za-z0-9_-]+))?$/.exec(requested);
  if (
    match === null ||
    match[1] !== PI_EVAL_PROVIDER ||
    match[2] !== PI_EVAL_MODEL_ID
  ) {
    throw new Error(
      `Pi Evals require ${PI_EVAL_MODEL}; received ${requested || "empty model"}`,
    );
  }
  if (match[3] !== undefined && match[3] !== PI_EVAL_THINKING_LEVEL) {
    throw new Error(
      `Pi Evals require thinking level ${PI_EVAL_THINKING_LEVEL}; received ${match[3]}`,
    );
  }
  return {
    provider: PI_EVAL_PROVIDER,
    modelId: PI_EVAL_MODEL_ID,
    thinkingLevel: PI_EVAL_THINKING_LEVEL,
    requested,
  };
}

/** Finds the last protocol line in worker stdout. SDK internals are not
 * allowed to become an implicit success signal: the marker and status must
 * both be present before classification can proceed. */
export function parsePiResult(output: string): PiWireResult | null {
  const lines = output.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (!isRecord(value) || value.protocol !== "tc-eval/pi-v1") continue;
      if (value.status !== "success" && value.status !== "error") return null;
      if (!isRecord(value.request) || !isRecord(value.observed)) return null;
      return value as unknown as PiWireResult;
    } catch {
      // A non-protocol log line is ignored; a missing protocol result is invalid.
    }
  }
  return null;
}

export function classifyPi(
  exitCode: number | null,
  result: PiWireResult | null,
  stoppedByController: boolean,
  timedOut: boolean,
): HostRun["status"] {
  if (timedOut) return "timeout";
  if (stoppedByController) return "interrupted";
  if (exitCode !== 0) return "error";
  if (result === null) return "invalid";
  if (result.status !== "success") return "error";
  return "success";
}

/** Runs one isolated Pi SDK session. The worker is a child process so the
 * controller can terminate the complete session and any tool descendants as
 * one process group, preserving the recovery case's durable checkpoint. */
export function runPi(
  request: HostRunRequest,
  phase: string,
): Promise<HostRun> {
  let model: PiModelRequest;
  try {
    model = parsePiModel(request.model);
  } catch (error) {
    return Promise.resolve({
      phase,
      status: "invalid",
      exitCode: null,
      signal: null,
      elapsedMs: 0,
      callCount: null,
      resultText: null,
      diagnostics: [describe(error)],
      hostVersion: null,
      model: null,
      resultMetadata: null,
      host: "pi-sdk",
      requestedModel: request.model ?? PI_EVAL_MODEL,
      requestedThinkingLevel: PI_EVAL_THINKING_LEVEL,
      observedProvider: null,
      observedApi: null,
      observedThinkingLevel: null,
    });
  }

  const started = Date.now();
  const workerPath =
    process.env[WORKER_OVERRIDE_ENV] ??
    fileURLToPath(new URL("./pi-worker.ts", import.meta.url));
  const tools = request.tools === "" ? [] : ["read", "bash", "edit", "write"];
  const wireRequest = {
    cwd: request.cwd,
    prompt: request.prompt,
    provider: model.provider,
    modelId: model.modelId,
    thinkingLevel: model.thinkingLevel,
    tools,
    ...(request.jsonSchema === undefined
      ? {}
      : { jsonSchema: request.jsonSchema }),
  };
  const metadataRequest = {
    provider: model.provider,
    modelId: model.modelId,
    thinkingLevel: model.thinkingLevel,
    tools,
    ...(request.jsonSchema === undefined
      ? {}
      : { jsonSchema: request.jsonSchema }),
  };
  const child = spawn(process.execPath, [workerPath], {
    cwd: request.cwd,
    shell: false,
    detached: true,
    env: {
      ...process.env,
      PATH: `${request.cwd}/bin:${process.env.PATH ?? ""}`,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  let stoppedByController = false;
  let timedOut = false;
  let polling = false;
  let pollTimer: NodeJS.Timeout | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;
  const diagnostics: string[] = [];
  const pid = child.pid;
  const stopWhen = request.stopWhen;
  const pollMs = request.pollMs ?? DEFAULT_POLL_MS;

  return new Promise((resolve) => {
    const finish = (exitCode: number | null, signal: string | null): void => {
      if (settled) return;
      settled = true;
      if (pollTimer !== undefined) clearInterval(pollTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      const parsed = parsePiResult(stdout);
      const status = classifyPi(
        exitCode,
        parsed,
        stoppedByController,
        timedOut,
      );
      if (parsed?.diagnostics !== undefined)
        diagnostics.push(...parsed.diagnostics);
      if (parsed?.error !== undefined)
        diagnostics.push(`pi worker: ${parsed.error}`);
      if (parsed === null && stdout.trim() !== "") {
        diagnostics.push("Pi worker emitted no valid protocol result");
      }
      if (stderr.trim() !== "") diagnostics.push(`stderr: ${truncate(stderr)}`);
      resolve({
        phase,
        status,
        exitCode,
        signal,
        elapsedMs: Date.now() - started,
        callCount: parsed?.callCount ?? null,
        resultText: parsed?.resultText ?? null,
        diagnostics: diagnostics.slice(0, 8),
        hostVersion: parsed?.hostVersion ?? null,
        model: parsed?.observed.model ?? null,
        resultMetadata: {
          adapter: "pi-sdk",
          request: parsed?.request ?? metadataRequest,
          observed: parsed?.observed ?? null,
          ...(parsed?.error === undefined ? {} : { error: parsed.error }),
        },
        host: "pi-sdk",
        requestedModel: model.requested,
        requestedThinkingLevel: model.thinkingLevel,
        observedProvider: parsed?.observed.provider ?? null,
        observedApi: parsed?.observed.api ?? null,
        observedThinkingLevel: parsed?.observed.providerThinkingLevel ?? null,
      });
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      diagnostics.push(`spawn failed: ${describe(error)}`);
      finish(null, null);
    });
    child.on("close", (exitCode, signal) => {
      finish(exitCode, signal);
    });

    const terminateGroup = (signal: NodeJS.Signals): void => {
      if (pid === undefined) return;
      try {
        process.kill(-pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          diagnostics.push(`group kill (${signal}) failed: ${describe(error)}`);
        }
      }
    };

    const stop = (): void => {
      if (pollTimer !== undefined) clearInterval(pollTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      terminateGroup("SIGTERM");
      setTimeout(() => {
        if (!settled) terminateGroup("SIGKILL");
      }, TERMINATION_GRACE_MS).unref();
    };

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      stop();
    }, request.timeoutMs);

    if (stopWhen !== undefined) {
      pollTimer = setInterval(() => {
        if (settled || polling || stoppedByController) return;
        polling = true;
        void stopWhen()
          .then((checkpointReached) => {
            if (checkpointReached && !settled && !stoppedByController) {
              stoppedByController = true;
              diagnostics.push("checkpoint observed; interrupting the session");
              stop();
            }
          })
          .catch((error: unknown) => {
            diagnostics.push(`checkpoint probe failed: ${describe(error)}`);
          })
          .finally(() => {
            polling = false;
          });
      }, pollMs);
    }

    child.stdin.on("error", (error: Error) => {
      diagnostics.push(`stdin failed: ${describe(error)}`);
    });
    child.stdin.end(`${JSON.stringify(wireRequest)}\n`);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, limit = 600): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}
