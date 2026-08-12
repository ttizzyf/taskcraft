// tc review changes: requests changes on the current revision. One reducer
// transaction writes a blocking finding, closes the review attempt as
// changes_requested and creates a successor execute attempt; scope and
// contract stay unchanged. --reviewed-attempt defaults to the review link.

import type { Command } from "commander";

import { reviewChanges } from "../core/reducer.js";
import type { ReviewChangesInput } from "../core/reducer.js";
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

export function register(review: Command): void {
  review
    .command("changes")
    .description(
      "request changes with a blocking finding and a successor execute attempt",
    )
    .argument("<task>", "task id")
    .requiredOption("--attempt <attempt-id>", "review attempt id")
    .option(
      "--reviewed-attempt <attempt-id>",
      "reviewed execute attempt id (default from the review link)",
    )
    .requiredOption("--finding <finding>", "what must change")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const expectedRevision = parseExpectedRevision(
          command.optsWithGlobals().expectedRevision,
        );
        const database = openTaskcraftDatabase(true);

        try {
          const reviewedAttemptId =
            options.reviewedAttempt ??
            resolveReviewedAttempt(database, taskId, options.attempt);
          const input: ReviewChangesInput = {
            taskId,
            attemptId: options.attempt,
            reviewedAttemptId,
            finding: options.finding,
          };

          if (expectedRevision !== undefined) {
            input.expectedRevision = expectedRevision;
          }

          const result = reviewChanges(database, taskId, input);
          const data: ReviewRenderData = {
            ...result,
            outcome: "changes_requested",
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
