// tc task cancel: writes the cancellation facts through the reducer. The
// reason is required; re-cancelling is rejected with
// TC_TASK_ALREADY_CANCELLED by the reducer.

import type { Command } from "commander";

import { cancel } from "../core/reducer.js";
import type { CancelInput } from "../core/reducer.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  printCommandResult,
} from "./helpers.js";
import { renderCommandData } from "./render.js";

export function register(task: Command): void {
  task
    .command("cancel")
    .description("cancel a task")
    .argument("<task>", "task id")
    .requiredOption("--reason <reason>", "cancellation reason")
    .option("--expected-revision <n>", "expected task revision")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const database = openTaskcraftDatabase(true);

        try {
          const input: CancelInput = { reason: options.reason };
          const expectedRevision = parseExpectedRevision(
            options.expectedRevision,
          );

          if (expectedRevision !== undefined) {
            input.expectedRevision = expectedRevision;
          }

          const data = cancel(database, taskId, input);

          if (json) {
            printCommandResult(data);
          } else {
            console.log(renderCommandData(data));
          }
        } finally {
          database.close();
        }
      }, json);
    });
}
