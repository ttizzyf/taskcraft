// tc review: the review command group (start / pass / changes / replan).
// --expected-revision is declared on the group so Commander consumes it
// before the subcommands parse (same same-name pitfall as `run` /
// `run complete`); every subcommand reads it through optsWithGlobals.

import type { Command } from "commander";

import { register as registerReviewChanges } from "./review-changes.js";
import { register as registerReviewPass } from "./review-pass.js";
import { register as registerReviewReplan } from "./review-replan.js";
import { register as registerReviewStart } from "./review-start.js";

export function register(program: Command): void {
  const review = program
    .command("review")
    .description("review management")
    .option("--expected-revision <n>", "expected task revision");

  registerReviewStart(review);
  registerReviewPass(review);
  registerReviewChanges(review);
  registerReviewReplan(review);
}
