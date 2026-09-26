import {
  IS_WINDOWS,
  execFileCommand,
  spawnCommand,
  terminateTree,
} from "../core/process.ts";
import { prependPath } from "../core/workspace.ts";

import type { HostRun, HostRunRequest } from "../core/types.ts";

const CLAUDE_COMMAND = "claude";
const DEFAULT_POLL_MS = 250;
const TERMINATION_GRACE_MS = 2_000;

/** Spawns Claude Code in print/stream mode and resolves when the process
 * (and its owned subprocess tree) exits or is stopped by the controller.
 *
 * The child is detached into its own process group so interruption can kill
 * every descendant it spawned (tc/node/pnpm/git and their children); Windows
 * walks the same tree with taskkill /T. Killing only the claude wrapper leaks
 * grandchildren that keep the stdio pipes open and leave a lingering
 * checkpoint probe polling into the next phase.
 */
export function runClaude(
  request: HostRunRequest,
  phase: string,
): Promise<HostRun> {
  const started = Date.now();
  const hostVersion = readHostVersion();
  const child = spawnCommand(CLAUDE_COMMAND, buildArgs(request), {
    cwd: request.cwd,
    shell: false,
    // A detached child leads its own process group so interruption can kill
    // every descendant it spawned; Windows relies on taskkill /T instead.
    detached: true,
    env: {
      ...process.env,
      PATH: prependPath(request.cwd),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  let stoppedByController = false;
  let timedOut = false;
  let polling = false;
  let terminalSignal: NodeJS.Signals | null = null;
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
      const parsed = parseStream(stdout);
      diagnostics.push(...parsed.diagnostics);
      if (stderr.trim() !== "") diagnostics.push(`stderr: ${truncate(stderr)}`);
      const status = classify(exitCode, parsed, stoppedByController, timedOut);
      resolve({
        phase,
        status,
        exitCode,
        // A killed Windows child reports no signal, so the forced tree kill
        // the controller applied is reported instead of a silent null.
        signal: signal ?? terminalSignal,
        elapsedMs: Date.now() - started,
        callCount: parsed.callCount,
        resultText: parsed.resultText,
        diagnostics: diagnostics.slice(0, 8),
        hostVersion,
        model: parsed.model,
        resultMetadata: parsed.resultMetadata,
        host: "claude",
        requestedModel: request.model ?? null,
        requestedThinkingLevel: null,
        observedProvider: null,
        observedApi: null,
        observedThinkingLevel: null,
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
      // A detached child is a process-group leader; the negative pid targets
      // the whole group, including every subprocess the model spawned.
      // Windows walks the same tree from the child pid instead.
      if (pid === undefined) return;
      terminalSignal = signal;
      try {
        terminateTree(pid, signal === "SIGKILL");
      } catch (error) {
        diagnostics.push(`tree kill (${signal}) failed: ${describe(error)}`);
      }
    };

    const stop = (): void => {
      if (pollTimer !== undefined) clearInterval(pollTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      // Windows console trees can only be force-terminated (taskkill refuses
      // them without /F), so the interruption starts at the SIGKILL step.
      terminateGroup(IS_WINDOWS ? "SIGKILL" : "SIGTERM");
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
    child.stdin.end(request.prompt);
  });
}

function buildArgs(request: HostRunRequest): string[] {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: {} }),
    "--permission-mode",
    "acceptEdits",
    "--tools",
    request.tools ??
      (IS_WINDOWS ? "Bash,PowerShell,Read,Edit,Write" : "Bash,Read,Edit,Write"),
  ];
  const allowedTools = request.allowedTools ?? [
    "Read",
    "Edit",
    "Write",
    ...shellAllowPatterns(),
  ];
  if (allowedTools.length > 0) args.push("--allowed-tools", ...allowedTools);
  if (request.model !== undefined) args.push("--model", request.model);
  if (request.jsonSchema !== undefined) {
    args.push("--json-schema", request.jsonSchema);
  }
  return args;
}

/** Claude Code on Windows exposes the shell as `PowerShell`, not `Bash`, so
 * both shell tools are enabled and allowlisted here; naming only Bash leaves
 * the actor without any command execution and makes tc unreachable. */
function shellAllowPatterns(): string[] {
  const patterns = [
    "tc *",
    "node *",
    "pnpm *",
    "git *",
    "pwd",
    "ls *",
    "find *",
  ];
  const shells = IS_WINDOWS ? ["Bash", "PowerShell"] : ["Bash"];
  return shells.flatMap((shell) =>
    patterns.map((pattern) => `${shell}(${pattern})`),
  );
}

interface ParsedStream {
  resultText: string | null;
  resultEvent: Record<string, unknown> | null;
  resultMetadata: Record<string, unknown> | null;
  model: string | null;
  diagnostics: string[];
  callCount: number | null;
}

/** Parses Claude Code stream-json lines into a summary for classification.
 * Malformed lines and is_error results surface as diagnostics rather than
 * being silently treated as success. */
export function parseStream(output: string): ParsedStream {
  const diagnostics: string[] = [];
  let resultEvent: Record<string, unknown> | null = null;
  let model: string | null = null;
  let calls = 0;
  let sawAssistant = false;
  for (const line of output.split("\n")) {
    const text = line.trim();
    if (!text) continue;
    try {
      const value = JSON.parse(text) as unknown;
      if (!isRecord(value)) {
        diagnostics.push("stream contained a non-object JSON message");
        continue;
      }
      if (value.type === "assistant") {
        calls += 1;
        sawAssistant = true;
      }
      if (value.type === "system" && typeof value.model === "string") {
        model = value.model;
      }
      if (value.type === "result") {
        resultEvent = value;
        if (typeof value.model === "string") model = value.model;
      }
    } catch (error) {
      diagnostics.push(`invalid stream message: ${describe(error)}`);
    }
  }
  const resultText =
    resultEvent === null ? null : extractResultText(resultEvent);
  const resultMetadata = resultEvent === null ? null : metadata(resultEvent);
  return {
    resultText,
    resultEvent,
    resultMetadata,
    model,
    diagnostics,
    callCount: sawAssistant ? calls : null,
  };
}

/** Maps exit and stream evidence to a stable HostRun status. Success requires
 * a clean exit plus a stream-json result event that did not flag is_error. */
export function classify(
  exitCode: number | null,
  parsed: ParsedStream,
  stoppedByController: boolean,
  timedOut: boolean,
): HostRun["status"] {
  if (timedOut) return "timeout";
  if (stoppedByController) return "interrupted";
  if (exitCode !== 0) return "error";
  if (parsed.resultEvent === null || parsed.diagnostics.length > 0) {
    return "invalid";
  }
  if (parsed.resultEvent.is_error === true) return "error";
  return "success";
}

function extractResultText(event: Record<string, unknown>): string | null {
  if (typeof event.structured_output === "object") {
    return JSON.stringify(event.structured_output);
  }
  return typeof event.result === "string" ? event.result : null;
}

function metadata(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  const keys = ["is_error", "subtype", "errors", "api_error_status", "model"];
  const selected = Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(event, key))
      .map((key) => [key, event[key]]),
  );
  return Object.keys(selected).length === 0 ? null : selected;
}

function readHostVersion(): string | null {
  try {
    const version = execFileCommand(CLAUDE_COMMAND, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return version === "" ? null : version;
  } catch {
    return null;
  }
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
