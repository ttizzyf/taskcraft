// Shared IO for the entry/stop hook gates: reading .taskcraft/config.json,
// probing the Task Store and finding the single active task projection.
// Hooks never spawn the tc CLI itself (no recursion) and never run
// migrations: the store is only probed read-only.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { project } from "../core/projector.js";
import type { Projection } from "../core/projector.js";
import { TaskcraftError } from "../core/errors.js";
import type { TaskcraftDatabase } from "../store/database.js";
import { openDatabase } from "../store/database.js";
import { listTasks } from "../store/query.js";

export const CONFIG_FILE_NAME = "config.json";
export const TASKCRAFT_DATABASE_FILE = "taskcraft.db";

export type TakeOverMode = "off" | "ask" | "always";

/** Persisted per-agent hook field-test outcome (parent design "Hook 结果
 * 持久化 (C/D 合同)"): config.hookTests[agent] = { testedAt, version, ok,
 * enforced, failure? }, written by test-hook, read by the CLI capabilities
 * command and the Watch runtime/diagnostics APIs (one shared source). */
export interface HookTestRecord {
  testedAt: string;
  version: string | null;
  ok: boolean;
  enforced: boolean;
  failure?: string;
}

export interface TaskcraftConfig {
  takeOver?: TakeOverMode;
  agents?: string[];
  hookTests?: Record<string, HookTestRecord>;
  [key: string]: unknown;
}

/** Reads the persisted hook field-test records from .taskcraft/config.json.
 * A missing, malformed or hookTests-less config yields an empty map (the
 * callers render "not tested"); never throws. */
export function readHookTests(
  configPath: string,
): Record<string, HookTestRecord> {
  let config: TaskcraftConfig;

  try {
    config = readTaskcraftConfig(configPath);
  } catch {
    return {};
  }

  const hookTests = config.hookTests;

  if (
    typeof hookTests !== "object" ||
    hookTests === null ||
    Array.isArray(hookTests)
  ) {
    return {};
  }

  return hookTests;
}

export function isTakeOverMode(value: unknown): value is TakeOverMode {
  return value === "off" || value === "ask" || value === "always";
}

/** Reads and structurally validates .taskcraft/config.json. Throws a plain
 * Error when the file is missing, malformed or carries an unknown takeOver
 * value; gate wrappers map that to a stable TC_ADAPTER_* error. */
export function readTaskcraftConfig(configPath: string): TaskcraftConfig {
  let text: string;

  try {
    text = readFileSync(configPath, "utf8");
  } catch (cause) {
    throw new Error(`cannot read ${configPath}: ${describeCause(cause)}`, {
      cause,
    });
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `malformed JSON in ${configPath}: ${describeCause(cause)}`,
      { cause },
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${configPath} must contain a JSON object`);
  }

  const record = parsed as Record<string, unknown>;

  if (record.takeOver !== undefined && !isTakeOverMode(record.takeOver)) {
    throw new Error(
      `takeOver must be off, ask or always, got: ${String(record.takeOver)}`,
    );
  }

  return record as TaskcraftConfig;
}

/** The Task Store path next to .taskcraft/config.json (both live in the
 * project's .taskcraft/ directory). */
export function databaseFileFor(configPath: string): string {
  return join(dirname(configPath), TASKCRAFT_DATABASE_FILE);
}

/** Opens the Task Store next to the config; null when the store was never
 * initialized (an uninstrumented project stays silent). */
export function openProjectDatabase(configPath: string): TaskcraftDatabase {
  return openDatabase(databaseFileFor(configPath));
}

/** The single active task projection, or null when there is no task, no
 * active task or several active tasks (ambiguous: no unique next). */
export function findActiveProjection(
  database: TaskcraftDatabase,
): Projection | null {
  const active = listTasks(database)
    .map((task) => project(database, task.id))
    .filter((entry) => entry.status === "active");

  return active.length === 1 ? (active[0] ?? null) : null;
}

export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** True when the calling module runs as the hook script entry point
 * (`node dist/hooks/entry.js <config-path>`), false under tests and when the
 * module is imported by a command. */
export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];

  return entry !== undefined && resolve(entry) === fileURLToPath(moduleUrl);
}

/** Writes the stable three-part error the hook host surfaces as diagnostics;
 * stdout is never touched so a failed hook cannot pollute the session. */
export function writeHookDiagnostic(error: unknown): void {
  if (error instanceof TaskcraftError) {
    process.stderr.write(
      `error: ${error.code}: ${error.problem}\n` +
        `impact: ${error.impact}\n` +
        `remediation: ${error.remediation}\n`,
    );
    return;
  }

  process.stderr.write(`internal error: ${describeCause(error)}\n`);
}
