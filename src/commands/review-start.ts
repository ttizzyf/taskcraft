// tc review start: opens a review on the runnable review node. The review
// attempt, the review link (purpose, capability, independence disclosure) and
// the audit event are written in one reducer transaction. --capability
// defaults to context-only and --independence to unverified: the lowest
// truthful disclosure, never an assumed stronger one.

import type { Command } from "commander";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { reviewStart } from "../core/reducer.js";
import type { ReviewStartInput } from "../core/reducer.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  printCommandResult,
} from "./helpers.js";
import type { ReviewRenderData } from "./render.js";
import { renderReviewData } from "./render.js";
import { assertReviewAttemptSpecBindings } from "./spec-bindings.js";

const PURPOSES = ["feasibility", "delivery", "integration"] as const;
const CAPABILITIES = [
  "context-only",
  "manual-attach",
  "host-observed",
] as const;
const INDEPENDENCE_STATUSES = [
  "observed-distinct",
  "unverified",
  "same-actor",
  "unsupported",
] as const;

export function register(review: Command): void {
  review
    .command("start")
    .description("open a review on a runnable review node")
    .argument("<task>", "task id")
    .requiredOption("--node <node>", "review node id (review-1)")
    .requiredOption(
      "--purpose <purpose>",
      "review purpose: feasibility, delivery or integration",
    )
    .option(
      "--reviewed-attempt <attempt-id>",
      "reviewed attempt id (default: latest finished attempt of the audited kind)",
    )
    .option("--host <host>", "host name")
    .option(
      "--capability <capability>",
      "review correlation capability (default context-only)",
    )
    .option(
      "--independence <status>",
      "independence disclosure (default unverified)",
    )
    .option(
      "--session-id <id>",
      "observed host session id (required for observed-distinct)",
    )
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const purpose = parsePurpose(options.purpose);
        // The lowest truthful disclosure by default: capability=context-only
        // and independence=unverified, never an assumed stronger one.
        const capability = parseCapability(
          options.capability ?? "context-only",
        );
        const independenceStatus = parseIndependence(
          options.independence ?? "unverified",
        );
        const expectedRevision = parseExpectedRevision(
          command.optsWithGlobals().expectedRevision,
        );
        const input: ReviewStartInput = {
          taskId,
          nodeId: options.node,
          purpose,
          capability,
          independenceStatus,
        };

        if (options.reviewedAttempt !== undefined) {
          input.reviewedAttemptId = options.reviewedAttempt;
        }

        if (options.host !== undefined) {
          input.host = options.host;
        }

        if (options.sessionId !== undefined) {
          input.observedHostSessionId = options.sessionId;
        }

        if (expectedRevision !== undefined) {
          input.expectedRevision = expectedRevision;
        }

        const database = openTaskcraftDatabase(true);

        try {
          const bindingCheck = assertReviewAttemptSpecBindings(
            database,
            taskId,
            options.node,
            expectedRevision,
          );
          if (
            input.expectedRevision === undefined &&
            bindingCheck.taskRevision !== undefined
          ) {
            input.expectedRevision = bindingCheck.taskRevision;
          }
          const result = reviewStart(database, taskId, input);
          const data: ReviewRenderData = {
            ...result,
            purpose,
            capability,
            independenceStatus,
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

function parsePurpose(value: string): ReviewStartInput["purpose"] {
  return parseEnumOption(value, PURPOSES, "--purpose");
}

function parseCapability(value: string): ReviewStartInput["capability"] {
  return parseEnumOption(value, CAPABILITIES, "--capability");
}

function parseIndependence(
  value: string,
): ReviewStartInput["independenceStatus"] {
  return parseEnumOption(value, INDEPENDENCE_STATUSES, "--independence");
}

function parseEnumOption<T extends string>(
  value: string,
  allowed: readonly T[],
  option: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
      problem: `${option} must be one of ${allowed.join(", ")}, got: ${value}`,
      impact: "No facts were written",
      remediation: `Retry with a valid ${option} value`,
    });
  }

  return value as T;
}
