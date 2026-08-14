// Read-only diagnostics aggregation for the watch API. Every item is derived
// from the Task Store, the takeover config and the installed hook files;
// nothing here writes files. A bounded --version probe compares the current
// host with the persisted field-test version; it never starts an agent run.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { defaultProbe } from "../adapters/shared.js";
import type { ProbeFn } from "../adapters/types.js";
import {
  TASKCRAFT_DATABASE_FILE,
  TASKCRAFT_DIRECTORY_NAME,
  migrationsDirectory,
} from "../commands/helpers.js";
import { ERROR_CODES } from "../core/errors.js";
import { CONFIG_FILE_NAME, readTaskcraftConfig } from "../hooks/shared.js";
import type { TaskcraftDatabase } from "../store/database.js";
import { openDatabase } from "../store/database.js";
import { applyMigrations, MigrationError } from "../store/migrations.js";
import { getAgentRuns, getOpenBlockers, listTasks } from "../store/query.js";
import {
  WATCH_DIAGNOSTIC_CODES,
  type DiagnosticItem,
} from "./diagnostic-types.js";
import { collectHookDiagnostics } from "./hook-diagnostics.js";

export { WATCH_DIAGNOSTIC_CODES } from "./diagnostic-types.js";
export type { DiagnosticItem, DiagnosticSource } from "./diagnostic-types.js";

export function collectDiagnostics(
  projectDir: string,
  probe: ProbeFn = defaultProbe,
): DiagnosticItem[] {
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
    collectHookDiagnostics(projectDir, configFile, items, probe);
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
