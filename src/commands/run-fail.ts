// tc run fail: marks an attempt failed through the reducer and, when the
// node's retry budget is exhausted, opens the failed_retries_exhausted
// blocker so the projector derives waiting. The reason is required; every
// failure exits 1 with the stable error triple.

import type { Command } from "commander";

import { runFail } from "../core/reducer.js";
import type { AttemptFailureInput } from "../core/reducer.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  printCommandResult,
} from "./helpers.js";
import { renderCommandData } from "./render.js";

export function register(runCommand: Command): void {
  runCommand
    .command("fail")
    .description("mark an attempt failed")
    .argument("<task>", "task id")
    .requiredOption("--attempt <attempt-id>", "attempt id to fail")
    .requiredOption("--reason <text>", "failure reason")
    .option("--expected-revision <n>", "expected task revision")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const expectedRevision = parseExpectedRevision(
          options.expectedRevision,
        );
        const input: AttemptFailureInput = {
          attemptId: options.attempt,
          reason: options.reason,
        };

        if (expectedRevision !== undefined) {
          input.expectedRevision = expectedRevision;
        }

        const database = openTaskcraftDatabase(true);

        try {
          const data = runFail(database, taskId, input);

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
