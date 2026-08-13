// tc task wait: opens a typed blocker through the reducer so the projector
// derives waiting (needs_input / needs_decision / blocked_dependency). The
// reason code is pre-validated at the boundary with the same error contract
// the reducer re-validates in the transaction.

import type { Command } from "commander";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { taskWait } from "../core/reducer.js";
import type { TaskWaitInput, WaitingReasonCode } from "../core/reducer.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  printCommandResult,
} from "./helpers.js";
import { renderCommandData } from "./render.js";

const WAITING_REASON_CODES = [
  "needs_input",
  "needs_decision",
  "blocked_dependency",
];

export function register(task: Command): void {
  task
    .command("wait")
    .description("block a task waiting for input, a decision or a dependency")
    .argument("<task>", "task id")
    .requiredOption(
      "--reason <code>",
      "waiting reason: needs_input, needs_decision or blocked_dependency",
    )
    .requiredOption("--message <text>", "what the task is waiting for")
    .option(
      "--node <node>",
      "node id to block (default: the running or first runnable node)",
    )
    .option("--expected-revision <n>", "expected task revision")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const reasonCode = parseReasonCode(options.reason);
        const expectedRevision = parseExpectedRevision(
          options.expectedRevision,
        );
        const input: TaskWaitInput = {
          reasonCode,
          message: options.message,
        };

        if (options.node !== undefined) {
          input.nodeId = options.node;
        }

        if (expectedRevision !== undefined) {
          input.expectedRevision = expectedRevision;
        }

        const database = openTaskcraftDatabase(true);

        try {
          const data = taskWait(database, taskId, input);

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

function parseReasonCode(value: string): WaitingReasonCode {
  // Single source of truth: the reducer enum; this boundary check only fails
  // earlier with the same error contract.
  if (!WAITING_REASON_CODES.includes(value)) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
      problem: `--reason must be one of ${WAITING_REASON_CODES.join(", ")}, got: ${value}`,
      impact: "No facts were written",
      remediation: "Retry with a valid waiting reason code",
      context: { reasonCode: value },
    });
  }

  return value as WaitingReasonCode;
}
