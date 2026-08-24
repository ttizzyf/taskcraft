// tc run complete: validates the submitted result and, in one reducer
// transaction, satisfies the target node obligations (execute-1 also carries
// the optional record segment). The result can come from a JSON argument, a
// @path file or stdin (@-); unparsable input fails with
// TC_LIFECYCLE_RESULT_INVALID and writes nothing.

import type { Command } from "commander";

import { ERROR_CODES } from "../core/errors.js";
import { requiresSpecImpact, runComplete } from "../core/reducer.js";
import type { RunCompleteInput } from "../core/reducer.js";
import { getTask } from "../store/query.js";
import {
  loadSpecRegistry,
  parseSpecSelections,
  parseSpecImpactResult,
  resolveSpecImpactResult,
  resolveSpecSelections,
} from "../spec/index.js";
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
          const snapshot = getTask(database, taskId);
          const record = resolveRecordSegment(result, input.nodeId);
          if (
            record !== null &&
            "specImpact" in record &&
            snapshot !== null &&
            requiresSpecImpact(
              database,
              taskId,
              snapshot.currentLifecycleRevision,
            )
          ) {
            const impact = parseSpecImpactResult(record.specImpact);
            input.resolvedSpecImpact = resolveSpecImpactResult(
              impact.outcome === "updated"
                ? loadSpecRegistry(process.cwd())
                : null,
              impact,
            );
          }
          if (
            input.nodeId === "frame-1" &&
            snapshot?.level === 2 &&
            typeof result === "object" &&
            result !== null &&
            "specBindings" in result
          ) {
            const selections = parseSpecSelections(
              (result as { specBindings: unknown }).specBindings,
              "Frame specBindings",
            );
            input.resolvedSpecBindings =
              selections.length === 0
                ? []
                : resolveSpecSelections(
                    loadSpecRegistry(process.cwd()),
                    selections,
                  );
          }
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

function resolveRecordSegment(
  result: unknown,
  nodeId: string | undefined,
): Record<string, unknown> | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return null;
  }
  const object = result as Record<string, unknown>;
  if (nodeId === "record-1") return object;
  const record = object.record;
  return typeof record === "object" && record !== null && !Array.isArray(record)
    ? (record as Record<string, unknown>)
    : null;
}
