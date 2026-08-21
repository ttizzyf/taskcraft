// L1 built-in lifecycle: a static definition of the two-node graph, the
// execute/record result schemas and the obligation evaluators. The graph is
// materialized into the four lifecycle tables at task creation (revision 1)
// and is never modified afterwards (append-only triggers).

import { createHash } from "node:crypto";

import type { EvidenceRow } from "../../store/query.js";

export const L1_COMPILER_VERSION = "tc-l1/2";
export const L1_REASON_CODE = "initial";
export const L1_REASON = "initial L1 lifecycle";
export const L1_DEFAULT_ACTOR = "cli";

/** Default retry policy for L1 nodes: three failed attempts exhaust retries. */
export const L1_RETRY_POLICY = Object.freeze({ maxRetries: 3 });

export const L1_EXECUTE_NODE_ID = "execute-1";
export const L1_RECORD_NODE_ID = "record-1";

export const L1_OBLIGATION_IDS = Object.freeze({
  requestedOutcomeProduced: "requested-outcome-produced",
  minimumValidationRecorded: "minimum-validation-recorded",
  resultAndScopeRetained: "result-and-scope-retained",
});

/** Facts/policy are empty at L1 revision 1: the digest is the SHA-256 of the
 * empty string, which is stable for every L1 task. */
export const L1_FACTS_DIGEST = createHash("sha256").update("").digest("hex");
export const L1_POLICY_DIGEST = createHash("sha256").update("").digest("hex");

/** Draft 2020-12 JSON Schema for the record result segment. */
export const L1_RECORD_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: {
    summary: { type: "string", minLength: 1 },
    changedScope: { type: "object" },
    residualRisks: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
  },
} as const;

/** Draft 2020-12 JSON Schema accepted by `run complete` on execute-1. The
 * optional `record` segment satisfies the record obligation in the same
 * transaction. */
export const L1_EXECUTE_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "evidence"],
  properties: {
    summary: { type: "string", minLength: 1 },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "reference", "summary"],
        properties: {
          type: {
            type: "string",
            enum: ["validation", "test", "artifact", "note"],
          },
          reference: { type: "string", minLength: 1 },
          summary: { type: "string", minLength: 1 },
          digest: { type: "string" },
        },
      },
    },
    record: { $ref: "#/$defs/record" },
  },
  $defs: { record: L1_RECORD_RESULT_SCHEMA },
} as const;

export interface L1NodeDefinition {
  id: string;
  kind: "execute" | "record";
  title: string;
  procedureRef: string;
  outputSchemaJson: string;
}

export const L1_NODES: readonly L1NodeDefinition[] = Object.freeze([
  {
    id: L1_EXECUTE_NODE_ID,
    kind: "execute",
    title: "Execute",
    procedureRef: "l1:execute",
    outputSchemaJson: JSON.stringify(L1_EXECUTE_RESULT_SCHEMA),
  },
  {
    id: L1_RECORD_NODE_ID,
    kind: "record",
    title: "Record",
    procedureRef: "l1:record",
    outputSchemaJson: JSON.stringify(L1_RECORD_RESULT_SCHEMA),
  },
]);

export const L1_EDGE = Object.freeze({
  fromNodeId: L1_EXECUTE_NODE_ID,
  toNodeId: L1_RECORD_NODE_ID,
  conditionJson: JSON.stringify({ kind: "always" }),
  label: null,
});

export interface L1ObligationDefinition {
  nodeId: string;
  id: string;
  duty: "required";
  title: string;
  evaluatorJson: string;
}

export const L1_OBLIGATIONS: readonly L1ObligationDefinition[] = Object.freeze([
  {
    nodeId: L1_EXECUTE_NODE_ID,
    id: L1_OBLIGATION_IDS.requestedOutcomeProduced,
    duty: "required",
    title: "Requested outcome produced",
    evaluatorJson: JSON.stringify({ kind: "evidence-exists" }),
  },
  {
    nodeId: L1_EXECUTE_NODE_ID,
    id: L1_OBLIGATION_IDS.minimumValidationRecorded,
    duty: "required",
    title: "Minimum validation recorded",
    evaluatorJson: JSON.stringify({
      kind: "evidence-type",
      type: "validation",
    }),
  },
  {
    nodeId: L1_RECORD_NODE_ID,
    id: L1_OBLIGATION_IDS.resultAndScopeRetained,
    duty: "required",
    title: "Result and scope retained",
    evaluatorJson: JSON.stringify({ kind: "record-result" }),
  },
]);

export interface L1ObligationContext {
  /** Evidence rows bound to the target execute attempt (current revision). */
  attemptEvidence: EvidenceRow[];
  /** Whether the submitted execute result carried a record segment. */
  hasRecordResult: boolean;
}

/** Evaluates an L1 obligation against the facts the reducer is about to
 * commit. Required obligations can only be satisfied by evidence owned by the
 * target attempt: the caller passes only that attempt's evidence rows. */
export function evaluateL1Obligation(
  obligationId: string,
  context: L1ObligationContext,
): boolean {
  switch (obligationId) {
    case L1_OBLIGATION_IDS.requestedOutcomeProduced:
      return context.attemptEvidence.length > 0;
    case L1_OBLIGATION_IDS.minimumValidationRecorded:
      return context.attemptEvidence.some(
        (evidence) => evidence.type === "validation",
      );
    case L1_OBLIGATION_IDS.resultAndScopeRetained:
      return context.hasRecordResult;
    default:
      return false;
  }
}
