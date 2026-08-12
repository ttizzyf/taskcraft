// Stop hook logic (parent design "Stop Logic" + REQ-02): waiting/done/
// cancelled tasks and tasks without runnable/running work are allowed to
// stop; an active task with runnable or running nodes blocks the stop and
// prints the unique next command. The pure decideStop is fully testable; the
// IO wrapper is the thin hook script entry. Loop protection: both hosts feed
// the current Stop input back as `stop_hook_active=true` on the second stop
// of the same turn (verified by the Task 00 probes CX-02/CL-02); the hook
// MUST honour it and allow the stop, or the agent loops forever re-blocking
// its own turn.

import { existsSync, readFileSync } from "node:fs";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import type { Projection } from "../core/projector.js";
import {
  databaseFileFor,
  describeCause,
  findActiveProjection,
  isMainModule,
  openProjectDatabase,
  readTaskcraftConfig,
  writeHookDiagnostic,
} from "./shared.js";
import type { TakeOverMode } from "./shared.js";

export type StopDecision = "allow" | { action: "block"; next: string };

/** Pure judgment: only an active task with runnable or running nodes blocks
 * the stop. waiting/done/cancelled/queued and active tasks without work are
 * allowed to stop. */
export function decideStop(projection: Projection | null): StopDecision {
  if (projection === null || projection.status !== "active") {
    return "allow";
  }

  const hasWork =
    projection.runnableNodes.length > 0 || projection.runningNode !== null;

  if (!hasWork) {
    return "allow";
  }

  return {
    action: "block",
    next: projection.next ?? projection.breadcrumb.next.command,
  };
}

/** Loop guard: when the host reports `stop_hook_active=true` (this Stop is
 * the re-entry of a turn the hook already blocked once), the hook must let
 * the agent stop instead of re-blocking forever. Applied on top of
 * decideStop. */
export function decideStopForHook(
  stopHookActive: boolean,
  projection: Projection | null,
): StopDecision {
  if (stopHookActive) {
    return "allow";
  }

  return decideStop(projection);
}

export interface StopGateOutput {
  decision: StopDecision;
  /** The breadcrumb line the hook prints while blocking; null when allowed. */
  output: string | null;
}

/** IO wrapper: reads .taskcraft/config.json and the active task projection,
 * then maps the pure decision to the hook output. takeOver off disables the
 * block entirely (`tc enable off` must mean zero hook output). */
export function runStopGate(
  configPath: string,
  stopHookActive = false,
): StopGateOutput {
  const config = readConfig(configPath);

  if (config.takeOver === "off") {
    return { decision: "allow", output: null };
  }

  if (!existsSync(databaseFileFor(configPath))) {
    return { decision: "allow", output: null };
  }

  const database = openProjectDatabase(configPath);

  try {
    const projection = findActiveProjection(database);
    const decision = decideStopForHook(stopHookActive, projection);
    const output =
      decision !== "allow" && projection !== null
        ? JSON.stringify(projection.breadcrumb)
        : null;

    return { decision, output };
  } catch (cause) {
    throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED, {
      problem: `Stop hook could not project active tasks: ${describeCause(cause)}`,
      impact: "The stop hook cannot decide whether to block",
      remediation: "Inspect the Task Store with: tc status",
      context: { configPath },
      cause,
    });
  } finally {
    database.close();
  }
}

function readConfig(configPath: string): { takeOver: TakeOverMode } {
  try {
    const config = readTaskcraftConfig(configPath);

    return { takeOver: config.takeOver ?? "off" };
  } catch (cause) {
    throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED, {
      problem: `Stop hook config is missing or malformed: ${describeCause(cause)}`,
      impact: "The stop hook cannot decide whether to block",
      remediation:
        "Re-run: tc init --agent codex|claude, then tc enable <mode>",
      context: { configPath },
      cause,
    });
  }
}

// Hook script entry point: `node dist/hooks/stop.js <config-path>`. Blocks
// (exit 2, the host protocol's "continue" signal) with the breadcrumb when a
// node is runnable/running; allows the stop otherwise. Failures surface as
// the stable three-part diagnostics on stderr and exit 1 (host shows the
// error and still allows the stop).
if (isMainModule(import.meta.url)) {
  runAsHookScript();
}

/** Reads the host Stop hook input (JSON on stdin) and returns
 * `stop_hook_active`. Both codex and claude feed the current Stop input back
 * on re-entry; a malformed or absent payload simply means "first stop" and
 * defaults to false. */
function readStopHookActive(): boolean {
  try {
    const payload = readFileSync(0, "utf8").trim();

    if (payload.length === 0) {
      return false;
    }

    const parsed = JSON.parse(payload) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("stop_hook_active" in parsed) ||
      typeof parsed.stop_hook_active !== "boolean"
    ) {
      return false;
    }

    return parsed.stop_hook_active;
  } catch {
    return false;
  }
}

function runAsHookScript(): void {
  const configPath = process.argv[2];

  if (configPath === undefined) {
    writeHookDiagnostic(
      new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED, {
        problem:
          "Stop hook requires the .taskcraft/config.json path as its first argument",
        impact: "The stop hook cannot decide whether to block",
        remediation: "Re-run: tc init --agent codex|claude",
      }),
    );
    process.exit(1);
  }

  try {
    const { decision, output } = runStopGate(configPath, readStopHookActive());

    if (decision !== "allow") {
      if (output !== null) {
        process.stdout.write(`${output}\n`);
      }

      process.exitCode = 2;
    }
  } catch (error) {
    writeHookDiagnostic(error);
    process.exitCode = 1;
  }
}
