// tc review replan: the review found the scope, contract or lifecycle graph
// itself changed. One reducer transaction writes a blocking finding, a new
// lifecycle revision (typed reason code) and supersedes the old revision's
// open attempts; the new revision's first runnable node becomes next.
// --reviewed-attempt defaults to the review link.

import type { Command } from "commander";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { reviewReplan } from "../core/reducer.js";
import type { ReviewReplanInput } from "../core/reducer.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  printCommandResult,
  resolveReviewedAttempt,
} from "./helpers.js";
import type { ReviewRenderData } from "./render.js";
import { renderReviewData } from "./render.js";

const REPLAN_REASON_CODES = [
  "replan_required",
  "scope_changed",
  "contract_changed",
  "level_changed",
  "manual_revision",
] as const;

export function register(review: Command): void {
  review
    .command("replan")
    .description("replan with a blocking finding and a new lifecycle revision")
    .argument("<task>", "task id")
    .requiredOption("--attempt <attempt-id>", "review attempt id")
    .option(
      "--reviewed-attempt <attempt-id>",
      "reviewed execute attempt id (default from the review link)",
    )
    .requiredOption(
      "--reason <code>",
      "revision reason code: replan_required, scope_changed, contract_changed, level_changed or manual_revision",
    )
    .requiredOption("--finding <finding>", "contract change description")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const reasonCode = parseReasonCode(options.reason);
        const expectedRevision = parseExpectedRevision(
          command.optsWithGlobals().expectedRevision,
        );
        const database = openTaskcraftDatabase(true);

        try {
          const reviewedAttemptId =
            options.reviewedAttempt ??
            resolveReviewedAttempt(database, taskId, options.attempt);
          const input: ReviewReplanInput = {
            taskId,
            attemptId: options.attempt,
            reviewedAttemptId,
            reasonCode,
            finding: options.finding,
          };

          if (expectedRevision !== undefined) {
            input.expectedRevision = expectedRevision;
          }

          const result = reviewReplan(database, taskId, input);
          const data: ReviewRenderData = {
            ...result,
            outcome: "replan_required",
            finding: options.finding,
          };

          if (json) {
            printCommandResult(data);
          } else {
            console.log(renderReviewData(data));
          }
        } finally {
          database.close();
        }
      }, json);
    });
}

function parseReasonCode(value: string): ReviewReplanInput["reasonCode"] {
  if (!(REPLAN_REASON_CODES as readonly string[]).includes(value)) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
      problem: `--reason must be one of ${REPLAN_REASON_CODES.join(", ")}, got: ${value}`,
      impact: "No facts were written",
      remediation: "Retry with a lifecycle revision reason code",
    });
  }

  return value as ReviewReplanInput["reasonCode"];
}
