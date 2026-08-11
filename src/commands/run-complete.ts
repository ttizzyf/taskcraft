// tc run complete: validates the submitted result and, in one reducer
// transaction, satisfies the target node obligations (execute-1 also carries
// the optional record segment). The result can come from a JSON argument, a
// @path file or stdin (@-); unparsable input fails with
// TC_LIFECYCLE_RESULT_INVALID and writes nothing.

import type { Command } from "commander";

import { ERROR_CODES } from "../core/errors.js";
import { runComplete } from "../core/reducer.js";
import type { RunCompleteInput } from "../core/reducer.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  parseJsonInput,
  printCommandResult,
} from "./helpers.js";
import { renderCommandData } from "./render.js";

export function registerRunComplete(run: Command): void {
  run
    .command("complete")
    .description("complete the active attempt of a node")
    .argument("<task>", "task id")
    .option("--node <node>", "node id to complete (default execute-1)")
    .requiredOption("--result <result>", "result JSON, @path or @-")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const result = parseJsonInput(
          options.result,
          ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID,
          "Result",
        );
        const database = openTaskcraftDatabase(true);

        try {
          // --node is declared on both `run` and `run complete`; Commander
          // lets the parent `run` consume the value first, so read it through
          // the merged globals (same pattern as --expected-revision).
          const input: RunCompleteInput = {
            result,
            nodeId: command.optsWithGlobals().node,
          };
          // --expected-revision is declared on the parent `run` command
          // (Commander resolves same-named options to the parent); read it
          // through the merged globals here.
          const expectedRevision = parseExpectedRevision(
            command.optsWithGlobals().expectedRevision,
          );

          if (expectedRevision !== undefined) {
            input.expectedRevision = expectedRevision;
          }

          const data = runComplete(database, taskId, input);

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
