// tc state: the projection command behind the entry hook and scripting.
// --breadcrumb replays the silent entry gate (takeOver off, no Task Store,
// no task and non-active projections stay silent with exit 0; the unique
// active task prints exactly one breadcrumb line) and --json prints the
// full projected state as a command result (same data as tc status --json).

import { join } from "node:path";

import type { Command } from "commander";

import { runEntryGate } from "../hooks/entry.js";
import { CONFIG_FILE_NAME } from "../hooks/shared.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  printCommandResult,
  taskcraftDirectory,
} from "./helpers.js";
import { renderStatusData } from "./render.js";
import { buildStatusData } from "./status.js";

export function register(program: Command): void {
  program
    .command("state")
    .description(
      "show the current state; --breadcrumb prints the entry-hook breadcrumb",
    )
    .option(
      "--breadcrumb",
      "print the entry-hook breadcrumb JSON (silent when off or no active task)",
    )
    .action(async (options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        if (options.breadcrumb === true) {
          printBreadcrumb();
          return;
        }

        const database = openTaskcraftDatabase(true);

        try {
          const data = buildStatusData(database);

          if (json) {
            printCommandResult(data);
          } else {
            console.log(renderStatusData(data));
          }
        } finally {
          database.close();
        }
      }, json);
    });
}

/** Prints the entry-hook breadcrumb line, or nothing. runEntryGate is the
 * exact function the hook script used to run, so this CLI path is
 * behaviourally identical to the old `node dist/hooks/entry.js` gate:
 * takeOver off, an uninitialized store, no task and non-active projections
 * stay silent; the unique active task prints exactly one breadcrumb line.
 * Failures surface through execute() with the stable TC_ADAPTER_* error,
 * matching the hook's exit-1 diagnostics. */
function printBreadcrumb(): void {
  const configPath = join(taskcraftDirectory(), CONFIG_FILE_NAME);
  const { output } = runEntryGate(configPath);

  if (output !== null) {
    console.log(output);
  }
}
