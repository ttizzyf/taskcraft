// Command-boundary plumbing shared by every CLI command: opening the Task
// Store, parsing structured inputs (@path / @- / raw JSON), rendering the
// command result and mapping failures to exit codes. Commands only consume
// the core/store interfaces; this module never derives task state itself.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Command } from "commander";

import {
  commandFailure,
  commandOk,
  errorFromTaskcraftError,
} from "../core/command-result.js";
import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import type { TaskcraftErrorCode } from "../core/errors.js";
import type { TaskcraftDatabase } from "../store/database.js";
import { openDatabase } from "../store/database.js";
import { applyMigrations, MigrationError } from "../store/migrations.js";

export const TASKCRAFT_DIRECTORY_NAME = ".taskcraft";
export const TASKCRAFT_DATABASE_FILE = "taskcraft.db";

export function taskcraftDirectory(cwd: string = process.cwd()): string {
  return join(cwd, TASKCRAFT_DIRECTORY_NAME);
}

/** Opens the Task Store. `requireInitialized` guards read/write commands so
 * that `tc init` stays the only initialization entry point. */
export function openTaskcraftDatabase(
  requireInitialized: boolean,
): TaskcraftDatabase {
  const directory = taskcraftDirectory();
  const databaseFile = join(directory, TASKCRAFT_DATABASE_FILE);

  if (requireInitialized && !existsSync(databaseFile)) {
    throw new TaskcraftError(ERROR_CODES.TC_NOT_INITIALIZED, {
      problem: "Taskcraft is not initialized in this directory",
      impact: "Commands need a Task Store to read or write task facts",
      remediation: "Initialize the store with: tc init",
    });
  }

  mkdirSync(directory, { recursive: true });

  const database = openDatabase(databaseFile);
  applyMigrations(database, migrationsDirectory());

  return database;
}

/** Resolves the migrations directory from the module location so the CLI
 * works from any cwd (dist/commands -> repo root migrations). */
export function migrationsDirectory(): string {
  return fileURLToPath(new URL("../../migrations", import.meta.url));
}

/** Parses a structured input: `@path` reads a file, `@-` reads stdin and any
 * other value is parsed as raw JSON. Failures become a stable TC_* error. */
export function parseJsonInput(
  input: string,
  code: TaskcraftErrorCode,
  context: string,
): unknown {
  let text: string;

  try {
    if (input === "@-") {
      text = readFileSync(0, "utf8");
    } else if (input.startsWith("@")) {
      text = readFileSync(input.slice(1), "utf8");
    } else {
      text = input;
    }
  } catch (cause) {
    throw new TaskcraftError(code, {
      problem: `${context} cannot be read: ${describeCause(cause)}`,
      impact: "No facts were written",
      remediation:
        "Submit the value as raw JSON, a @path to a file, or @- for stdin",
      cause,
    });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new TaskcraftError(code, {
      problem: `${context} is not valid JSON: ${describeCause(cause)}`,
      impact: "No facts were written",
      remediation:
        "Submit the value as raw JSON, a @path to a file, or @- for stdin",
      cause,
    });
  }
}

/** Parses an optional --expected-revision option into a positive integer. */
export function parseExpectedRevision(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const revision = Number(value);

  if (!Number.isInteger(revision) || revision < 1) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
      problem: `--expected-revision must be a positive integer, got: ${value}`,
      impact: "The command was not applied",
      remediation: "Retry with the revision from: tc status --json",
    });
  }

  return revision;
}

/** Runs a command action, maps TaskcraftError and stable TC_STORE_* store
 * failures to exit 1 and unexpected failures to exit 2 (distinct from
 * Commander's own error handling). */
export function execute(action: () => void, json: boolean): void {
  try {
    action();
  } catch (error) {
    if (error instanceof TaskcraftError) {
      writeFailure(error, json);
      process.exitCode = 1;
    } else if (error instanceof MigrationError) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      process.exitCode = 1;
    } else {
      writeInternalError(error);
      process.exitCode = 2;
    }
  }
}

/** True when the root `--json` global option is set, for any command. */
export function isJsonMode(command: Command): boolean {
  return command.optsWithGlobals().json === true;
}

export function printCommandResult<T>(data: T): void {
  console.log(JSON.stringify(commandOk(data), null, 2));
}

function writeFailure(error: TaskcraftError, json: boolean): void {
  if (json) {
    process.stderr.write(
      `${JSON.stringify(commandFailure([errorFromTaskcraftError(error)]), null, 2)}\n`,
    );
    return;
  }

  process.stderr.write(
    `error: ${error.code}: ${error.problem}\n` +
      `impact: ${error.impact}\n` +
      `remediation: ${error.remediation}\n`,
  );
}

function writeInternalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause !== undefined
      ? `\ncause: ${describeCause(error.cause)}`
      : "";
  process.stderr.write(`internal error: ${message}${cause}\n`);
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  return String(cause);
}
