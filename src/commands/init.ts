// tc init: idempotently creates .taskcraft/ + the Task Store database and
// applies migrations. An existing database is only checked, never overwritten
// (the migration ledger guards the schema; user data stays untouched).

import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Command } from "commander";

import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  printCommandResult,
  TASKCRAFT_DIRECTORY_NAME,
  TASKCRAFT_DATABASE_FILE,
} from "./helpers.js";

export function register(program: Command): void {
  program
    .command("init")
    .description("initialize the Taskcraft store (idempotent)")
    .action(async (_options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const directory = join(process.cwd(), TASKCRAFT_DIRECTORY_NAME);
        const databaseFile = join(directory, TASKCRAFT_DATABASE_FILE);
        const alreadyInitialized = existsSync(databaseFile);
        const database = openTaskcraftDatabase(false);
        database.close();

        const data = { directory, databaseFile, alreadyInitialized };

        if (json) {
          printCommandResult(data);
          return;
        }

        console.log(
          alreadyInitialized
            ? "Already initialized Taskcraft store"
            : "Initialized Taskcraft store",
        );
        console.log(`Directory: ${directory}`);
        console.log(`Database: ${databaseFile}`);
      }, json);
    });
}
