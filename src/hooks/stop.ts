// Stop hook logic (parent design "Stop Logic" + REQ-02): waiting/done/
// cancelled tasks and tasks without runnable/running work are allowed to
// stop; an active task with runnable or running nodes blocks the stop and
// prints the unique next command. The pure decideStop is fully testable; the
// IO wrapper is the thin hook script entry. stop_hook_active loop protection
// is owned by the host protocol, so the script never re-blocks a turn.

import { existsSync } from "node:fs";

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

export interface StopGateOutput {
  decision: StopDecision;
  /** The breadcrumb line the hook prints while blocking; null when allowed. */
  output: string | null;
}

/** IO wrapper: reads .taskcraft/config.json and the active task projection,
 * then maps the pure decision to the hook output. takeOver off disables the
 * block entirely (`tc enable off` must mean zero hook output). */
export function runStopGate(configPath: string): StopGateOutput {
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
    const decision = decideStop(projection);
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
    const { decision, output } = runStopGate(configPath);

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
