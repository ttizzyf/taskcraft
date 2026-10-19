import {
  Ajv2020,
  type AnySchema,
  type ValidateFunction,
} from "ajv/dist/2020.js";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import type { LoadedSpecRegistry } from "./types.js";

export const SPEC_IMPACT_RESULT_SCHEMA = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["outcome", "reason"],
      properties: {
        outcome: { const: "none" },
        reason: { type: "string", minLength: 1, pattern: "\\S" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["outcome", "updates"],
      properties: {
        outcome: { const: "updated" },
        updates: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["specId", "path", "evidenceRefs"],
            properties: {
              specId: { type: "string", minLength: 1, pattern: "\\S" },
              path: { type: "string", minLength: 1, pattern: "\\S" },
              evidenceRefs: {
                type: "array",
                minItems: 1,
                uniqueItems: true,
                items: { type: "string", minLength: 1, pattern: "\\S" },
              },
            },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["outcome", "candidates"],
      properties: {
        outcome: { const: "candidate" },
        candidates: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "title", "rule", "reason", "ownerDecision"],
            properties: {
              kind: { type: "string", enum: ["engineering", "domain"] },
              title: { type: "string", minLength: 1, pattern: "\\S" },
              rule: { type: "string", minLength: 1, pattern: "\\S" },
              reason: { type: "string", minLength: 1, pattern: "\\S" },
              ownerDecision: {
                type: "string",
                minLength: 1,
                pattern: "\\S",
              },
            },
          },
        },
      },
    },
  ],
} as const;

export type SpecImpactResult =
  | { outcome: "none"; reason: string }
  | {
      outcome: "updated";
      updates: Array<{
        specId: string;
        path: string;
        evidenceRefs: string[];
      }>;
    }
  | {
      outcome: "candidate";
      candidates: Array<{
        kind: "engineering" | "domain";
        title: string;
        rule: string;
        reason: string;
        ownerDecision: string;
      }>;
    };

let validator: ValidateFunction | undefined;

export function parseSpecImpactResult(
  value: unknown,
  context = "Spec Impact",
): SpecImpactResult {
  validator ??= new Ajv2020({ strict: true, allErrors: true }).compile(
    SPEC_IMPACT_RESULT_SCHEMA as AnySchema,
  );
  if (!validator(value)) {
    throw impactInvalid(`${context} does not match the typed impact schema`);
  }
  const impact = structuredClone(value as SpecImpactResult);
  if (impact.outcome === "updated") {
    const ids = impact.updates.map((update) => update.specId);
    if (new Set(ids).size !== ids.length) {
      throw impactInvalid(`${context} repeats an updated Spec id`);
    }
  }
  return impact;
}

/** Command/service boundary validation for `updated`. It proves every
 * submitted identity is an active current Registry entry; none/candidate are
 * intentionally filesystem-free and never write Registry truth. */
export function resolveSpecImpactResult(
  registry: LoadedSpecRegistry | null,
  value: unknown,
): SpecImpactResult {
  const impact = parseSpecImpactResult(value);
  if (impact.outcome !== "updated") return impact;
  if (registry === null) {
    throw impactInvalid(
      "Updated Spec Impact requires the current project Spec Registry",
    );
  }
  const currentById = new Map(registry.specs.map((spec) => [spec.id, spec]));
  for (const update of impact.updates) {
    const current = currentById.get(update.specId);
    if (
      current === undefined ||
      current.status !== "active" ||
      current.path !== update.path
    ) {
      throw impactInvalid(
        `Updated Spec ${update.specId} is not the active current Registry entry`,
      );
    }
  }
  return impact;
}

export function assertResolvedSpecImpact(
  submitted: SpecImpactResult,
  resolved: SpecImpactResult | undefined,
): void {
  if (submitted.outcome !== "updated" && resolved === undefined) return;
  if (resolved === undefined) {
    throw impactInvalid(
      "The submitted Spec Impact was not resolved at the command boundary",
    );
  }
  const checkedResolved = parseSpecImpactResult(
    resolved,
    "Resolved Spec Impact",
  );
  if (!specImpactResultsEqual(submitted, checkedResolved)) {
    throw impactInvalid(
      "The submitted Spec Impact was not resolved at the command boundary",
    );
  }
}

/** Semantic comparison for the command/reducer hand-off and stored-result
 * auditing. Object key order, update order and evidence-ref order are not
 * contract facts; duplicate ids/refs are rejected by parsing before here. */
export function specImpactResultsEqual(
  left: SpecImpactResult,
  right: SpecImpactResult,
): boolean {
  return (
    JSON.stringify(canonicalImpact(left)) ===
    JSON.stringify(canonicalImpact(right))
  );
}

function canonicalImpact(impact: SpecImpactResult): unknown {
  if (impact.outcome === "none") {
    return { outcome: impact.outcome, reason: impact.reason };
  }
  if (impact.outcome === "candidate") {
    return {
      outcome: impact.outcome,
      candidates: impact.candidates.map((candidate) => ({
        kind: candidate.kind,
        title: candidate.title,
        rule: candidate.rule,
        reason: candidate.reason,
        ownerDecision: candidate.ownerDecision,
      })),
    };
  }
  return {
    outcome: impact.outcome,
    updates: impact.updates
      .map((update) => ({
        specId: update.specId,
        path: update.path,
        evidenceRefs: [...update.evidenceRefs].sort(),
      }))
      .sort((left, right) => left.specId.localeCompare(right.specId)),
  };
}

function impactInvalid(problem: string): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_SPEC_IMPACT_INVALID, {
    problem,
    impact: "No Record, Spec Impact, evidence or obligation facts were written",
    remediation:
      "Submit none with a reason, updated with current Registry snapshots and task evidence, or candidate with an owner decision",
  });
}
