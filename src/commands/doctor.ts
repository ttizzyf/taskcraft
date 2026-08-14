// tc doctor: read-only integrity checks. The store is opened without applying
// migrations and every check runs without a write transaction; the database
// file must already exist (TC_NOT_INITIALIZED otherwise, and nothing is
// created). A healthy store exits 0 with a summary; each failed check carries
// a stable TC_STORE_* error with problem/impact/remediation and the exit code
// is 1. `--json` prints the structured check list.

import { existsSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import type { Command } from "commander";

import { runDoctorChecks, type DoctorCheck } from "../core/doctor.js";
import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import type { TaskcraftDatabase } from "../store/database.js";
import {
  execute,
  isJsonMode,
  migrationsDirectory,
  printCommandFailure,
  printCommandResult,
  TASKCRAFT_DATABASE_FILE,
  taskcraftDirectory,
} from "./helpers.js";

export function register(program: Command): void {
  program
    .command("doctor")
    .description("run read-only integrity checks on the Task Store")
    .action(async (_options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const database = openDoctorDatabase();

        try {
          const checks = runDoctorChecks(database, migrationsDirectory());
          const failedChecks = checks.filter((check) => !check.ok);

          if (json) {
            if (failedChecks.length === 0) {
              printCommandResult({
                healthy: true,
                totalChecks: checks.length,
                failedChecks: 0,
                checks,
              });
            } else {
              printCommandFailure(failedChecks.map((check) => check.error!));
            }
          } else {
            printTextReport(checks);
          }

          if (failedChecks.length > 0) {
            process.exitCode = 1;
          }
        } finally {
          database.close();
        }
      }, json);
    });
}

/** Opens the store read-only. The file must already exist: doctor never
 * initializes or creates anything, so an uninitialized directory stays
 * untouched. A file that exists but cannot be opened is itself an integrity
 * finding. */
function openDoctorDatabase(): TaskcraftDatabase {
  const databaseFile = join(taskcraftDirectory(), TASKCRAFT_DATABASE_FILE);

  if (!existsSync(databaseFile)) {
    throw new TaskcraftError(ERROR_CODES.TC_NOT_INITIALIZED, {
      problem: "Taskcraft is not initialized in this directory",
      impact: "Doctor needs an existing Task Store to check its integrity",
      remediation: "Initialize the store with: tc init",
    });
  }

  try {
    // Read-only connection: journal_mode and synchronous are write-path
    // settings, so only the read-relevant pragmas are applied.
    const database = new Database(databaseFile, { readonly: true });

    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");

    return database;
  } catch (cause) {
    throw new TaskcraftError(ERROR_CODES.TC_STORE_INTEGRITY_FAILED, {
      problem:
        "The Task Store file exists but cannot be opened for a read-only check",
      impact: "The database could not be read at all",
      remediation:
        "Restore the database file from a backup, then re-run: tc doctor",
      cause,
    });
  }
}

function printTextReport(checks: DoctorCheck[]): void {
  const failedChecks = checks.filter((check) => !check.ok);

  if (failedChecks.length === 0) {
    console.log(`Doctor: ${checks.length} checks passed`);
    return;
  }

  console.log(
    `Doctor: ${failedChecks.length} of ${checks.length} checks failed`,
  );

  for (const check of failedChecks) {
    const error = check.error!;

    console.log();
    console.log(`error: ${error.code}: ${error.problem}`);
    console.log(`impact: ${error.impact}`);
    console.log(`remediation: ${error.remediation}`);
  }
}
