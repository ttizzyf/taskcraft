// Silent entry gate (product.md §6 + parent design "Silent Entry Gate").
// decideEntry is a pure, fully testable judgment; runEntryGate is the thin
// IO wrapper behind the public `tc state --breadcrumb` command, which the
// installed entry wrapper (entry.sh) delegates to (commandized gate — parent
// design "state（命令化，hooks 改调它）"). The gate never writes task facts:
// ask/always + durable-request decisions are returned to the caller, the
// command only prints or stays silent.

import { existsSync } from "node:fs";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import type { BreadcrumbV1 } from "../core/breadcrumb.js";
import type { Projection } from "../core/projector.js";
import { listTasks } from "../store/query.js";
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

export type EntryDecision =
  | { kind: "silent" }
  | { kind: "ask-create"; taskAnchor: null }
  | { kind: "create-and-anchor"; taskAnchor: null }
  | { kind: "inject"; breadcrumb: BreadcrumbV1; next: string };

/** Pure judgment matrix:
 * - takeOver off -> silent (zero output, zero writes)
 * - no active task + not durable -> silent (ordinary Q&A)
 * - no active task + durable + ask -> ask once to create a task card
 * - no active task + durable + always -> create a draft task and anchor
 * - active task -> inject the compact breadcrumb (anchor + node + next)
 * Non-active projections (waiting/done/cancelled/queued) never inject: the
 * caller only passes active tasks, and a defensive silence beats a wrong
 * breadcrumb. */
export function decideEntry(
  takeOver: TakeOverMode,
  projection: Projection | null,
  durableRequest: boolean,
): EntryDecision {
  if (takeOver === "off") {
    return { kind: "silent" };
  }

  if (projection === null) {
    if (!durableRequest) {
      return { kind: "silent" };
    }

    return takeOver === "ask"
      ? { kind: "ask-create", taskAnchor: null }
      : { kind: "create-and-anchor", taskAnchor: null };
  }

  if (projection.status !== "active") {
    return { kind: "silent" };
  }

  return {
    kind: "inject",
    breadcrumb: projection.breadcrumb,
    next: projection.next ?? projection.breadcrumb.next.command,
  };
}

export interface EntryGateOutput {
  decision: EntryDecision;
  /** The single line the hook script prints; null means silent. */
  output: string | null;
}

const CREATE_TASK_HINT =
  'Taskcraft: no active task. Create one with: tc task new --title "<title>" --level 1 --reason "<reason>"';

/** IO wrapper: reads .taskcraft/config.json, probes the Task Store for the
 * single active task and maps the pure decision to the hook output line.
 * durableRequest stays false by default because a SessionStart hook cannot
 * see the prompt; prompt-aware callers (e.g. UserPromptSubmit hooks) may
 * pass their own judgment. */
export function runEntryGate(
  configPath: string,
  durableRequest: boolean = false,
): EntryGateOutput {
  const config = readConfig(configPath);

  if (config.takeOver === "off") {
    return { decision: { kind: "silent" }, output: null };
  }

  if (!existsSync(databaseFileFor(configPath))) {
    // No Task Store: nothing to inject, and hooks must stay quiet in plain
    // repos (product.md §6 first check: Taskcraft installed?).
    return { decision: { kind: "silent" }, output: null };
  }

  const database = openProjectDatabase(configPath);

  try {
    // A project that already has tasks is never a fresh Q&A: the create
    // question only applies when the Task Store has no task at all, and a
    // non-active projection (waiting/done/cancelled/queued) stays silent.
    const tasks = listTasks(database);
    const projection =
      tasks.length === 0 ? null : findActiveProjection(database);
    const decision = decideEntry(
      config.takeOver,
      projection,
      tasks.length === 0 && durableRequest,
    );
    const output = outputFor(decision);

    return { decision, output };
  } catch (cause) {
    throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED, {
      problem: `Entry hook could not project active tasks: ${describeCause(cause)}`,
      impact: "The entry hook cannot inject a breadcrumb",
      remediation: "Inspect the Task Store with: tc status",
      context: { configPath },
      cause,
    });
  } finally {
    database.close();
  }
}

function outputFor(decision: EntryDecision): string | null {
  switch (decision.kind) {
    case "silent":
      return null;
    case "inject":
      return JSON.stringify(decision.breadcrumb);
    case "ask-create":
    case "create-and-anchor":
      return CREATE_TASK_HINT;
  }
}

function readConfig(configPath: string): { takeOver: TakeOverMode } {
  try {
    const config = readTaskcraftConfig(configPath);

    return { takeOver: config.takeOver ?? "off" };
  } catch (cause) {
    throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED, {
      problem: `Entry hook config is missing or malformed: ${describeCause(cause)}`,
      impact: "The entry hook cannot decide whether to inject a breadcrumb",
      remediation:
        "Re-run: tc init --agent codex|claude, then tc enable <mode>",
      context: { configPath },
      cause,
    });
  }
}

// Hook script entry point: `node dist/hooks/entry.js <config-path>`. The
// script prints one breadcrumb line for an active task and nothing otherwise;
// failures go to stderr as the stable three-part diagnostics.
if (isMainModule(import.meta.url)) {
  runAsHookScript();
}

function runAsHookScript(): void {
  const configPath = process.argv[2];

  if (configPath === undefined) {
    writeHookDiagnostic(
      new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED, {
        problem:
          "Entry hook requires the .taskcraft/config.json path as its first argument",
        impact: "The entry hook cannot decide whether to inject a breadcrumb",
        remediation: "Re-run: tc init --agent codex|claude",
      }),
    );
    process.exit(1);
  }

  try {
    const { output } = runEntryGate(configPath);

    if (output !== null) {
      process.stdout.write(`${output}\n`);
    }
  } catch (error) {
    writeHookDiagnostic(error);
    process.exit(1);
  }
}
