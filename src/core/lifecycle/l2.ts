// L2 built-in lifecycle: a static definition of the four-node graph
// (frame -> execute -> review -> record), the frame result schema and the
// four required obligations. L1 constants are reused for the execute/record
// contracts so a task keeps the same result shape when it moves between
// levels. The graph is materialized into the four lifecycle tables at task
// creation (revision 1) and at every replan revision; definitions are
// append-only afterwards.

import {
  L1_EXECUTE_RESULT_SCHEMA,
  L1_FACTS_DIGEST,
  L1_OBLIGATION_IDS,
  L1_POLICY_DIGEST,
  L1_RECORD_RESULT_SCHEMA,
} from "./l1.js";

export const L2_COMPILER_VERSION = "tc-l2/1";

/** L2 revisions carry the same empty facts/policy set at compile time; the
 * digests are stable for every L2 revision until facts change. */
export const L2_FACTS_DIGEST = L1_FACTS_DIGEST;
export const L2_POLICY_DIGEST = L1_POLICY_DIGEST;

export const L2_FRAME_NODE_ID = "frame-1";
export const L2_REVIEW_NODE_ID = "review-1";

export const L2_OBLIGATION_IDS = Object.freeze({
  ...L1_OBLIGATION_IDS,
  frameCompleted: "frame-completed",
  reviewCompleted: "review-completed",
});

/** Draft 2020-12 JSON Schema for the frame result: the task card contract
 * (objective, scope, acceptance) is restated statically in the node schema. */
export const L2_FRAME_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["objective", "scope", "acceptance"],
  properties: {
    objective: { type: "string", minLength: 1 },
    scope: { type: "object" },
    acceptance: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
  },
} as const;

export interface L2NodeDefinition {
  id: string;
  kind: "frame" | "execute" | "review" | "record";
  title: string;
  procedureRef: string;
  outputSchemaJson: string;
}

export const L2_NODES: readonly L2NodeDefinition[] = Object.freeze([
  {
    id: L2_FRAME_NODE_ID,
    kind: "frame",
    title: "Frame",
    procedureRef: "l2:frame",
    outputSchemaJson: JSON.stringify(L2_FRAME_RESULT_SCHEMA),
  },
  {
    id: "execute-1",
    kind: "execute",
    title: "Execute",
    procedureRef: "l2:execute",
    outputSchemaJson: JSON.stringify(L1_EXECUTE_RESULT_SCHEMA),
  },
  {
    id: L2_REVIEW_NODE_ID,
    kind: "review",
    title: "Review",
    procedureRef: "l2:review",
    // Review has no independent result schema: the outcome is written by the
    // review commands against the same evidence contract as execute.
    outputSchemaJson: "{}",
  },
  {
    id: "record-1",
    kind: "record",
    title: "Record",
    procedureRef: "l2:record",
    outputSchemaJson: JSON.stringify(L1_RECORD_RESULT_SCHEMA),
  },
]);

export const L2_EDGES: readonly { fromNodeId: string; toNodeId: string }[] =
  Object.freeze([
    { fromNodeId: L2_FRAME_NODE_ID, toNodeId: "execute-1" },
    { fromNodeId: "execute-1", toNodeId: L2_REVIEW_NODE_ID },
    { fromNodeId: L2_REVIEW_NODE_ID, toNodeId: "record-1" },
  ]);

export interface L2ObligationDefinition {
  nodeId: string;
  id: string;
  duty: "required";
  title: string;
  evaluatorJson: string;
}

export const L2_OBLIGATIONS: readonly L2ObligationDefinition[] = Object.freeze([
  {
    nodeId: L2_FRAME_NODE_ID,
    id: L2_OBLIGATION_IDS.frameCompleted,
    duty: "required",
    title: "Frame completed",
    evaluatorJson: JSON.stringify({ kind: "frame-result" }),
  },
  {
    nodeId: "execute-1",
    id: L2_OBLIGATION_IDS.requestedOutcomeProduced,
    duty: "required",
    title: "Requested outcome produced",
    evaluatorJson: JSON.stringify({ kind: "evidence-exists" }),
  },
  {
    nodeId: "execute-1",
    id: L2_OBLIGATION_IDS.minimumValidationRecorded,
    duty: "required",
    title: "Minimum validation recorded",
    evaluatorJson: JSON.stringify({
      kind: "evidence-type",
      type: "validation",
    }),
  },
  {
    nodeId: L2_REVIEW_NODE_ID,
    id: L2_OBLIGATION_IDS.reviewCompleted,
    duty: "required",
    title: "Review completed",
    evaluatorJson: JSON.stringify({ kind: "review-passed" }),
  },
  {
    nodeId: "record-1",
    id: L2_OBLIGATION_IDS.resultAndScopeRetained,
    duty: "required",
    title: "Result and scope retained",
    evaluatorJson: JSON.stringify({ kind: "record-result" }),
  },
]);
