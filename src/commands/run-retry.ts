// tc run retry: creates a successor attempt for the same node through the
// reducer (old attempt stays failed). When the node's retry budget is spent
// the reducer writes the failed_retries_exhausted blocker instead and the
// command reports the waiting state; the successor id is echoed on success.

import type { Command } from "commander";

import { runRetry } from "../core/reducer.js";
import type { RunRetryInput } from "../core/reducer.js";
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
    .command("retry")
    .description("create a successor attempt for a failed or stale attempt")
    .argument("<task>", "task id")
    .requiredOption("--attempt <attempt-id>", "failed or superseded attempt id")
    .requiredOption("--reason <text>", "retry reason")
    .option("--expected-revision <n>", "expected task revision")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const expectedRevision = parseExpectedRevision(
          options.expectedRevision,
        );
        const input: RunRetryInput = {
          attemptId: options.attempt,
          reason: options.reason,
        };

        if (expectedRevision !== undefined) {
          input.expectedRevision = expectedRevision;
        }

        const database = openTaskcraftDatabase(true);

        try {
          const data = runRetry(database, taskId, input);

          if (json) {
            printCommandResult(data);
          } else {
            const lines = [renderCommandData(data)];

            if (data.successorAttemptId !== null) {
              lines.push(`Successor attempt: ${data.successorAttemptId}`);
            }

            console.log(lines.join("\n"));
          }
        } finally {
          database.close();
        }
      }, json);
    });
}
