// Read-only diagnostics aggregation for the watch API. Every item is derived
// from the Task Store, the takeover config and the installed hook files;
// nothing here writes files or probes a live host, so the endpoint stays safe
// to call repeatedly.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  TASKCRAFT_DATABASE_FILE,
  TASKCRAFT_DIRECTORY_NAME,
  migrationsDirectory,
} from "../commands/helpers.js";
import { ERROR_CODES } from "../core/errors.js";
import {
  CONFIG_FILE_NAME,
  readHookTests,
  readTaskcraftConfig,
} from "../hooks/shared.js";
import type { TaskcraftDatabase } from "../store/database.js";
import { openDatabase } from "../store/database.js";
import { applyMigrations, MigrationError } from "../store/migrations.js";
import { getAgentRuns, getOpenBlockers, listTasks } from "../store/query.js";

/** Watch-local codes for anomalies the core taxonomy does not name. */
export const WATCH_DIAGNOSTIC_CODES = {
  TC_RETRIES_EXHAUSTED: "TC_RETRIES_EXHAUSTED",
  TC_OBSERVATION_STALE: "TC_OBSERVATION_STALE",
  /** Installed hooks were never verified by a field test. */
  TC_HOOK_TEST_MISSING: "TC_HOOK_TEST_MISSING",
  /** The installed hook chain changed after the last recorded field test. */
  TC_HOOK_VERSION_DRIFT: "TC_HOOK_VERSION_DRIFT",
} as const;

export type DiagnosticSource = "store" | "migration" | "adapter" | "task";

export interface DiagnosticItem {
  code: string;
  problem: string;
  impact: string;
  remediation: string;
  source: DiagnosticSource;
}

export function collectDiagnostics(projectDir: string): DiagnosticItem[] {
  const storeDirectory = join(projectDir, TASKCRAFT_DIRECTORY_NAME);
  const databaseFile = join(storeDirectory, TASKCRAFT_DATABASE_FILE);
  const items: DiagnosticItem[] = [];

  if (!existsSync(databaseFile)) {
    items.push({
      code: ERROR_CODES.TC_NOT_INITIALIZED,
      problem: "The Task Store is not initialized in this project",
      impact: "Watch has no task data to display",
      remediation: "Initialize the store with: tc init",
      source: "store",
    });
    return items;
  }

  const database = openMigratedDatabase(databaseFile, items);

  if (database === null) {
    return items;
  }

  const configFile = join(storeDirectory, CONFIG_FILE_NAME);

  try {
    collectConfigItems(configFile, items);
    collectHookTestItems(projectDir, configFile, items);
    collectBlockerItems(database, items);
    collectObservationItems(database, items);
  } finally {
    database.close();
  }

  return items;
}

/** Opens the store and applies migrations; a failure becomes one diagnostic
 * item and the DB-dependent checks are skipped (the schema may only be
 * partially applied). */
function openMigratedDatabase(
  databaseFile: string,
  items: DiagnosticItem[],
): TaskcraftDatabase | null {
  let database: TaskcraftDatabase;

  try {
    database = openDatabase(databaseFile);
  } catch (cause) {
    items.push({
      code: "TC_STORE_OPEN_FAILED",
      problem: `Cannot open the Task Store: ${describe(cause)}`,
      impact: "Task data cannot be read",
      remediation:
        "Check the .taskcraft/taskcraft.db file, then re-run: tc watch",
      source: "store",
    });
    return null;
  }

  try {
    applyMigrations(database, migrationsDirectory());
    return database;
  } catch (cause) {
    database.close();

    if (cause instanceof MigrationError) {
      items.push({
        code: cause.code,
        problem: cause.message,
        impact: "The store schema cannot be trusted for this request",
        remediation: "Repair the migration state, then re-run: tc watch",
        source: "migration",
      });
    } else {
      items.push({
        code: "TC_STORE_MIGRATION_APPLY_FAILED",
        problem: `Applying migrations failed: ${describe(cause)}`,
        impact: "The store schema cannot be trusted for this request",
        remediation: "Repair the migration state, then re-run: tc watch",
        source: "migration",
      });
    }

    return null;
  }
}

function collectConfigItems(configFile: string, items: DiagnosticItem[]): void {
  // init does not write config.json; the default off mode is not an anomaly.
  if (!existsSync(configFile)) {
    return;
  }

  try {
    readTaskcraftConfig(configFile);
  } catch (cause) {
    items.push({
      code: ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED,
      problem: `The takeover config is unreadable: ${describe(cause)}`,
      impact: "Entry/Stop hook behavior cannot be verified from the config",
      remediation:
        "Fix .taskcraft/config.json or re-run: tc enable off|ask|always",
      source: "adapter",
    });
  }
}

/** Hook anomalies derived from config.hookTests compared against the
 * installed wrapper files (no re-running of the field test): a failed test,
 * wrappers that changed after the tested state (version drift) and installed
 * hooks that were never field-tested. */
function collectHookTestItems(
  projectDir: string,
  configFile: string,
  items: DiagnosticItem[],
): void {
  if (!existsSync(configFile)) {
    return;
  }

  const hookTests = readHookTests(configFile);
  const hooksDir = join(projectDir, TASKCRAFT_DIRECTORY_NAME, "hooks");
  const wrappers = {
    entry: join(hooksDir, "entry.sh"),
    stop: join(hooksDir, "stop.sh"),
  };

  for (const agent of Object.keys(hookTests).sort()) {
    const record = hookTests[agent]!;

    if (!record.ok) {
      items.push({
        code: ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED,
        problem: `Hook field test failed for ${agent}: ${record.failure ?? "unknown failure"}`,
        impact: "Entry injection or stop blocking could not be verified",
        remediation: `Fix the failing check, then re-run: tc agent test-hook --agent ${agent}`,
        source: "adapter",
      });
      continue;
    }

    if (!existsSync(wrappers.entry) || !existsSync(wrappers.stop)) {
      items.push({
        code: ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED,
        problem: `Installed hook wrapper is missing for ${agent}: ${wrappers.entry} or ${wrappers.stop}`,
        impact: "The host silently skips the missing wrapper",
        remediation: `Re-install the hooks: tc init --agent ${agent}`,
        source: "adapter",
      });
      continue;
    }

    const changed = hookChainChangedAfter(wrappers, record.testedAt);

    if (changed !== null) {
      items.push({
        code: WATCH_DIAGNOSTIC_CODES.TC_HOOK_VERSION_DRIFT,
        problem: `Installed hook chain for ${agent} changed after the last field test (${record.testedAt}): ${changed}`,
        impact:
          "The recorded hook version no longer reflects the installed scripts",
        remediation: `Re-run the field test: tc agent test-hook --agent ${agent}`,
        source: "adapter",
      });
    }
  }

  if (Object.keys(hookTests).length === 0 && existsSync(wrappers.entry)) {
    items.push({
      code: WATCH_DIAGNOSTIC_CODES.TC_HOOK_TEST_MISSING,
      problem: "Installed hooks were never field-tested",
      impact: "Entry/Stop hook behavior is unverified",
      remediation: "Verify them with: tc agent test-hook --agent codex|claude",
      source: "adapter",
    });
  }
}

/** True when a wrapper script or the gate artifact it references was
 * modified after the recorded test time (both wrappers and the built gates
 * are part of the installed chain). */
function hookChainChangedAfter(
  wrappers: { entry: string; stop: string },
  testedAt: string,
): string | null {
  const tested = Date.parse(testedAt);

  if (Number.isNaN(tested)) {
    return `unparsable testedAt ${testedAt}`;
  }

  for (const [label, path] of [
    ["entry.sh", wrappers.entry],
    ["stop.sh", wrappers.stop],
  ] as const) {
    if (modifiedAfter(path, tested)) {
      return `${label} was modified after the test`;
    }
  }

  for (const gate of referencedGatePaths([wrappers.entry, wrappers.stop])) {
    if (modifiedAfter(gate, tested)) {
      return `${gate} was rebuilt after the test`;
    }
  }

  return null;
}

function modifiedAfter(path: string, timestamp: number): boolean {
  try {
    return statSync(path).mtimeMs > timestamp;
  } catch {
    return false;
  }
}

/** Extracts the `node "<path>"` gate references from managed wrappers. */
function referencedGatePaths(scripts: readonly string[]): string[] {
  const paths: string[] = [];

  for (const script of scripts) {
    let text: string;

    try {
      text = readFileSync(script, "utf8");
    } catch {
      continue;
    }

    for (const match of text.matchAll(/node "([^"]+\.js)"/g)) {
      const path = match[1];

      if (path !== undefined) {
        paths.push(path);
      }
    }
  }

  return paths;
}

/** Aggregates open blockers into one item per task per anomaly category. */
function collectBlockerItems(
  database: TaskcraftDatabase,
  items: DiagnosticItem[],
): void {
  const tasksByKind = new Map<string, Set<string>>();
  const retriedTasks = new Set<string>();

  for (const task of listTasks(database)) {
    for (const blocker of getOpenBlockers(database, task.id)) {
      if (blocker.waitingReason === "failed_retries_exhausted") {
        retriedTasks.add(task.id);
      }

      if (
        blocker.kind === "conflict" ||
        blocker.kind === "evidence" ||
        blocker.kind === "host"
      ) {
        const tasks = tasksByKind.get(blocker.kind) ?? new Set<string>();
        tasks.add(task.id);
        tasksByKind.set(blocker.kind, tasks);
      }
    }
  }

  for (const taskId of tasksByKind.get("conflict") ?? []) {
    items.push({
      code: ERROR_CODES.TC_REVISION_CONFLICT,
      problem: `Task ${taskId} has an open revision conflict blocker`,
      impact: "The task may be based on a stale snapshot",
      remediation: "Re-read the latest state with: tc status",
      source: "task",
    });
  }

  for (const taskId of tasksByKind.get("evidence") ?? []) {
    items.push({
      code: ERROR_CODES.TC_REQUIRED_EVIDENCE_MISSING,
      problem: `Task ${taskId} is missing required evidence`,
      impact: "Required obligations cannot be satisfied without evidence",
      remediation: `Attach evidence to the pending attempt of ${taskId}`,
      source: "task",
    });
  }

  for (const taskId of tasksByKind.get("host") ?? []) {
    items.push({
      code: ERROR_CODES.TC_ADAPTER_UNSUPPORTED,
      problem: `Task ${taskId} is blocked by an unsupported host`,
      impact: "The host cannot carry the task forward",
      remediation: `Re-run ${taskId} with a supported host (codex or claude)`,
      source: "adapter",
    });
  }

  for (const taskId of retriedTasks) {
    items.push({
      code: WATCH_DIAGNOSTIC_CODES.TC_RETRIES_EXHAUSTED,
      problem: `Task ${taskId} exhausted its retries and is waiting`,
      impact: "No automatic retry remains for the task",
      remediation: "Intervene manually or replan the task",
      source: "task",
    });
  }
}

/** Unsupported hosts and stale observations are adapter-level anomalies. */
function collectObservationItems(
  database: TaskcraftDatabase,
  items: DiagnosticItem[],
): void {
  const unsupportedHosts = new Set<string>();
  const staleTasks = new Set<string>();

  for (const run of getAgentRuns(database)) {
    if (run.observationStatus === "unsupported") {
      unsupportedHosts.add(run.host);
    } else if (run.observationStatus === "stale") {
      staleTasks.add(run.taskId);
    }
  }

  for (const host of unsupportedHosts) {
    items.push({
      code: ERROR_CODES.TC_ADAPTER_UNSUPPORTED,
      problem: `Host ${host} is not supported`,
      impact: "Runs on this host cannot produce trusted observations",
      remediation: "Use a supported host: codex or claude",
      source: "adapter",
    });
  }

  for (const taskId of staleTasks) {
    items.push({
      code: WATCH_DIAGNOSTIC_CODES.TC_OBSERVATION_STALE,
      problem: `Task ${taskId} has stale observations`,
      impact: "The agent may have lost contact with the task",
      remediation: `Check the latest run of ${taskId} and retry or cancel it`,
      source: "adapter",
    });
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
