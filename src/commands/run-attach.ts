// tc run attach: registers an existing host run against the node attempt of
// the current revision through the reducer (the only agent_runs write path).
// Outputs the written observation id plus the projected command data;
// observations never change the task projection.

import type { Command } from "commander";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { runAttach } from "../core/reducer.js";
import type { RunAttachInput } from "../core/reducer.js";
import type { ObservationStatus } from "../store/query.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  printCommandResult,
} from "./helpers.js";
import { renderCommandData } from "./render.js";

const OBSERVATION_STATUSES: readonly ObservationStatus[] = [
  "pending",
  "running",
  "stale",
  "finished",
  "failed",
  "unsupported",
];

export function register(runCommand: Command): void {
  runCommand
    .command("attach")
    .description("register an existing host run against the node attempt")
    .argument("<task>", "task id")
    .option("--node <node>", "node id of the current revision")
    .requiredOption("--host-run-id <id>", "host-side run id")
    .option("--host-session-id <id>", "host-side session id")
    .option("--host <host>", "host name")
    .option(
      "--status <status>",
      "observation status: pending|running|stale|finished|failed|unsupported (default pending)",
    )
    .option("--expected-revision <n>", "expected task revision")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        // --node/--host/--expected-revision are declared on the parent `run`
        // command too; Commander lets the parent consume those values first,
        // so read them through the merged globals (same pattern as
        // run-complete). --host-run-id/--host-session-id/--status are
        // subcommand-only and live in the local options.
        const nodeId = command.optsWithGlobals().node;
        const host = command.optsWithGlobals().host;

        if (typeof nodeId !== "string" || nodeId.trim() === "") {
          throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
            problem: "run attach requires --node <node>",
            impact: "No facts were written",
            remediation:
              "Retry with the node of the current revision: --node execute-1",
            context: { taskId },
          });
        }

        const observationStatus = parseObservationStatus(
          options.status,
          taskId,
        );
        const input: RunAttachInput = {
          nodeId,
          hostRunId: options.hostRunId,
          ...(options.hostSessionId === undefined
            ? {}
            : { hostSessionId: options.hostSessionId }),
          ...(host === undefined ? {} : { host }),
          ...(observationStatus === undefined ? {} : { observationStatus }),
        };
        const expectedRevision = parseExpectedRevision(
          command.optsWithGlobals().expectedRevision,
        );

        if (expectedRevision !== undefined) {
          input.expectedRevision = expectedRevision;
        }

        const database = openTaskcraftDatabase(true);

        try {
          const data = runAttach(database, taskId, input);

          if (json) {
            printCommandResult(data);
          } else {
            console.log(
              [
                renderCommandData(data),
                `Observation: ${data.runId} (${data.observationStatus})`,
                `Node attempt: ${data.nodeAttemptId}`,
              ].join("\n"),
            );
          }
        } finally {
          database.close();
        }
      }, json);
    });
}

/** Maps --status to the observation status enum with a stable error; the
 * reducer re-validates the same range inside the transaction. */
function parseObservationStatus(
  value: string | undefined,
  taskId: string,
): ObservationStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!OBSERVATION_STATUSES.includes(value as ObservationStatus)) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
      problem: `Unknown observation status: ${value}`,
      impact: "No facts were written",
      remediation: `Retry with one of: ${OBSERVATION_STATUSES.join("|")}`,
      context: { taskId, status: value },
    });
  }

  return value as ObservationStatus;
}
