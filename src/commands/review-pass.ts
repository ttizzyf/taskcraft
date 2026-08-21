// tc review pass: closes the review with outcome=passed. --evidence is the
// evidence gate: at least one row must be submitted (raw JSON, @path or @-;
// a single object or an array is accepted). --finding is optional and written
// as an advisory finding by the reducer.

import type { Command } from "commander";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { reviewPass } from "../core/reducer.js";
import type { ReviewPassInput } from "../core/reducer.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  parseJsonInput,
  printCommandResult,
} from "./helpers.js";
import type { ReviewRenderData } from "./render.js";
import { renderReviewData } from "./render.js";
import { getAttempts } from "../store/query.js";
import {
  loadSpecRegistry,
  parseSpecSelections,
  resolveSpecSelections,
  type ResolvedSpecBinding,
} from "../spec/index.js";

const EVIDENCE_TYPES = ["validation", "test", "artifact", "note"] as const;

export function register(review: Command): void {
  review
    .command("pass")
    .description("close the review with outcome passed")
    .argument("<task>", "task id")
    .requiredOption("--attempt <attempt-id>", "review attempt id")
    .requiredOption(
      "--reviewed-attempt <attempt-id>",
      "reviewed execute attempt id",
    )
    .requiredOption(
      "--evidence <evidence>",
      "review evidence JSON, @path or @-",
    )
    .option("--finding <finding>", "optional advisory finding")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const evidence = parseEvidenceInput(options.evidence);
        const expectedRevision = parseExpectedRevision(
          command.optsWithGlobals().expectedRevision,
        );
        const input: ReviewPassInput = {
          taskId,
          attemptId: options.attempt,
          reviewedAttemptId: options.reviewedAttempt,
          evidence,
        };

        if (options.finding !== undefined) {
          input.finding = options.finding;
        }

        if (expectedRevision !== undefined) {
          input.expectedRevision = expectedRevision;
        }

        const database = openTaskcraftDatabase(true);

        try {
          const acceptedPlanSpecBindings = resolveAcceptedPlanSpecBindings(
            database,
            taskId,
            options.reviewedAttempt,
          );
          if (acceptedPlanSpecBindings !== undefined) {
            input.acceptedPlanSpecBindings = acceptedPlanSpecBindings;
          }
          const result = reviewPass(database, taskId, input);
          const data: ReviewRenderData = {
            ...result,
            outcome: "passed",
            ...(options.finding === undefined
              ? {}
              : { finding: options.finding }),
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

function resolveAcceptedPlanSpecBindings(
  database: Parameters<typeof getAttempts>[0],
  taskId: string,
  reviewedAttemptId: string,
): ReviewPassInput["acceptedPlanSpecBindings"] | undefined {
  const attempt = getAttempts(database, taskId).find(
    (candidate) => candidate.id === reviewedAttemptId,
  );
  if (attempt?.nodeId !== "plan-1" || attempt.resultJson === null) {
    return undefined;
  }
  const plan = JSON.parse(attempt.resultJson) as Record<string, unknown>;
  if (!("executionSpecs" in plan)) return undefined;
  const executionSelections = parseSpecSelections(
    plan.executionSpecs,
    "L3 executionSpecs",
  );
  if (!Array.isArray(plan.modules)) {
    throw new TaskcraftError(ERROR_CODES.TC_SPEC_BINDING_INVALID, {
      problem: "L3 Plan modules are unavailable for Spec resolution",
      impact: "No review or accepted Plan facts were written",
      remediation: "Resubmit the Plan result before passing Feasibility Review",
      context: { taskId },
    });
  }
  const moduleSelections = plan.modules.map((module, index) => {
    if (
      typeof module !== "object" ||
      module === null ||
      Array.isArray(module)
    ) {
      throw planBindingShapeError(taskId, index, "is not a Plan module object");
    }
    const key = (module as { key?: unknown }).key;
    if (typeof key !== "string" || key.trim() === "") {
      throw planBindingShapeError(taskId, index, "has no module key");
    }
    return {
      key,
      selections: parseSpecSelections(
        (module as { specBindings?: unknown }).specBindings,
        `L3 module ${key} specBindings`,
      ),
    };
  });
  const needsRegistry =
    executionSelections.length > 0 ||
    moduleSelections.some((module) => module.selections.length > 0);
  const registry = needsRegistry ? loadSpecRegistry(process.cwd()) : null;
  const resolve = (
    selections: ReturnType<typeof parseSpecSelections>,
  ): ResolvedSpecBinding[] =>
    registry === null ? [] : resolveSpecSelections(registry, selections);
  return {
    execution: resolve(executionSelections),
    modules: Object.fromEntries(
      moduleSelections.map((module) => [
        module.key,
        resolve(module.selections),
      ]),
    ),
  };
}

function planBindingShapeError(
  taskId: string,
  index: number,
  detail: string,
): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_SPEC_BINDING_INVALID, {
    problem: `L3 Plan module ${index + 1} ${detail}`,
    impact: "No review or accepted Plan facts were written",
    remediation:
      "Resubmit a schema-valid Plan before passing Feasibility Review",
    context: { taskId },
  });
}

/** Normalizes the evidence input (single object or array) into the reducer's
 * evidence rows; malformed items fail with TC_TASK_INPUT_INVALID before any
 * fact is written. */
function parseEvidenceInput(input: string): ReviewPassInput["evidence"] {
  const parsed = parseJsonInput(
    input,
    ERROR_CODES.TC_TASK_INPUT_INVALID,
    "Evidence",
  );
  const items = Array.isArray(parsed) ? parsed : [parsed];

  return items.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw evidenceShapeError(index, "is not an object");
    }

    const { type, reference, summary, digest } = item as Record<
      string,
      unknown
    >;

    if (
      typeof type !== "string" ||
      !(EVIDENCE_TYPES as readonly string[]).includes(type) ||
      typeof reference !== "string" ||
      reference.length === 0 ||
      typeof summary !== "string" ||
      summary.length === 0 ||
      (digest !== undefined && typeof digest !== "string")
    ) {
      throw evidenceShapeError(
        index,
        "must be an object with a string type (validation, test, artifact, note), reference and summary",
      );
    }

    return {
      type: type as ReviewPassInput["evidence"][number]["type"],
      reference,
      summary,
      ...(digest === undefined ? {} : { digest: digest as string }),
    };
  });
}

function evidenceShapeError(index: number, detail: string): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
    problem: `Evidence item ${index + 1} ${detail}`,
    impact: "No facts were written",
    remediation:
      "Submit evidence as JSON: an array of {type, reference, summary} objects, a @path file or @- for stdin",
  });
}
