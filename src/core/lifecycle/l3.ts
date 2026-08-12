// L3 built-in lifecycle: a static definition of the eight-node graph
// (frame -> plan -> feasibility review -> execute -> delivery review ->
// integrate -> integration review -> record), the plan and integrate result
// schemas and the nine required obligations. Feasibility review gates the
// execute node (lifecycle spec 9.1); the integration review is on-demand and
// only exists when the integrate result modified deliverables. L1/L2 result
// schemas are reused for frame/execute/record so a task keeps the same
// result shape across levels. The graph is materialized at task creation
// (revision 1) and at every replan revision; definitions are append-only
// afterwards.

import {
  L1_EXECUTE_RESULT_SCHEMA,
  L1_FACTS_DIGEST,
  L1_OBLIGATION_IDS,
  L1_POLICY_DIGEST,
  L1_RECORD_RESULT_SCHEMA,
} from "./l1.js";
import { L2_FRAME_RESULT_SCHEMA, L2_OBLIGATION_IDS } from "./l2.js";

export const L3_COMPILER_VERSION = "tc-l3/1";

/** L3 revisions carry the same empty facts/policy set at compile time; the
 * digests are stable for every L3 revision until facts change. */
export const L3_FACTS_DIGEST = L1_FACTS_DIGEST;
export const L3_POLICY_DIGEST = L1_POLICY_DIGEST;

export const L3_FRAME_NODE_ID = "frame-1";
export const L3_PLAN_NODE_ID = "plan-1";
export const L3_REVIEW_PLAN_NODE_ID = "review-plan-1";
export const L3_REVIEW_EXECUTE_NODE_ID = "review-execute-1";
export const L3_INTEGRATE_NODE_ID = "integrate-1";
export const L3_REVIEW_INTEGRATE_NODE_ID = "review-integrate-1";

export const L3_OBLIGATION_IDS = Object.freeze({
  ...L2_OBLIGATION_IDS,
  planCompleted: "plan-completed",
  feasibilityCompleted: "feasibility-completed",
  deliveryCompleted: "delivery-completed",
  integrationCompleted: "integration-completed",
  integrationReviewCompleted: "integration-review-completed",
});

/** Draft 2020-12 JSON Schema for the plan result: the feasibility contract
 * restated statically (objective coverage, child split, dependencies,
 * validation ownership and the integration path). */
export const L3_PLAN_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "objectiveCoverage",
    "children",
    "dependencies",
    "validationOwners",
    "integrationPath",
  ],
  properties: {
    objectiveCoverage: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    children: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title"],
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
        },
      },
    },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          satisfiedBy: { type: "string" },
        },
      },
    },
    validationOwners: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["childId", "owner"],
        properties: {
          childId: { type: "string", minLength: 1 },
          owner: { type: "string", minLength: 1 },
        },
      },
    },
    integrationPath: { type: "string", minLength: 1 },
  },
} as const;

/** Draft 2020-12 JSON Schema for the integrate result: per-child outcomes,
 * integration evidence and the on-demand integration review switch. */
export const L3_INTEGRATE_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["childrenResults", "integrationEvidence"],
  properties: {
    childrenResults: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["childId", "status"],
        properties: {
          childId: { type: "string", minLength: 1 },
          status: {
            type: "string",
            enum: ["passed", "failed", "skipped"],
          },
        },
      },
    },
    integrationEvidence: {
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
    modifiedDeliverables: { type: "boolean" },
  },
} as const;

export interface L3NodeDefinition {
  id: string;
  kind: "frame" | "plan" | "execute" | "review" | "integrate" | "record";
  title: string;
  procedureRef: string;
  outputSchemaJson: string;
}

export const L3_NODES: readonly L3NodeDefinition[] = Object.freeze([
  {
    id: L3_FRAME_NODE_ID,
    kind: "frame",
    title: "Frame",
    procedureRef: "l3:frame",
    outputSchemaJson: JSON.stringify(L2_FRAME_RESULT_SCHEMA),
  },
  {
    id: L3_PLAN_NODE_ID,
    kind: "plan",
    title: "Plan",
    procedureRef: "l3:plan",
    outputSchemaJson: JSON.stringify(L3_PLAN_RESULT_SCHEMA),
  },
  {
    id: L3_REVIEW_PLAN_NODE_ID,
    kind: "review",
    title: "Feasibility review",
    procedureRef: "l3:review",
    // Review has no independent result schema: the outcome is written by the
    // review commands against the reviewed attempt contract.
    outputSchemaJson: "{}",
  },
  {
    id: "execute-1",
    kind: "execute",
    title: "Execute",
    procedureRef: "l3:execute",
    outputSchemaJson: JSON.stringify(L1_EXECUTE_RESULT_SCHEMA),
  },
  {
    id: L3_REVIEW_EXECUTE_NODE_ID,
    kind: "review",
    title: "Delivery review",
    procedureRef: "l3:review",
    outputSchemaJson: "{}",
  },
  {
    id: L3_INTEGRATE_NODE_ID,
    kind: "integrate",
    title: "Integrate",
    procedureRef: "l3:integrate",
    outputSchemaJson: JSON.stringify(L3_INTEGRATE_RESULT_SCHEMA),
  },
  {
    id: L3_REVIEW_INTEGRATE_NODE_ID,
    kind: "review",
    title: "Integration review",
    procedureRef: "l3:review",
    outputSchemaJson: "{}",
  },
  {
    id: "record-1",
    kind: "record",
    title: "Record",
    procedureRef: "l3:record",
    outputSchemaJson: JSON.stringify(L1_RECORD_RESULT_SCHEMA),
  },
]);

export const L3_EDGES: readonly { fromNodeId: string; toNodeId: string }[] =
  Object.freeze([
    { fromNodeId: L3_FRAME_NODE_ID, toNodeId: L3_PLAN_NODE_ID },
    { fromNodeId: L3_PLAN_NODE_ID, toNodeId: L3_REVIEW_PLAN_NODE_ID },
    { fromNodeId: L3_REVIEW_PLAN_NODE_ID, toNodeId: "execute-1" },
    { fromNodeId: "execute-1", toNodeId: L3_REVIEW_EXECUTE_NODE_ID },
    { fromNodeId: L3_REVIEW_EXECUTE_NODE_ID, toNodeId: L3_INTEGRATE_NODE_ID },
    { fromNodeId: L3_INTEGRATE_NODE_ID, toNodeId: L3_REVIEW_INTEGRATE_NODE_ID },
    {
      fromNodeId: L3_REVIEW_INTEGRATE_NODE_ID,
      toNodeId: "record-1",
    },
  ]);

export interface L3ObligationDefinition {
  nodeId: string;
  id: string;
  duty: "required";
  title: string;
  evaluatorJson: string;
}

export const L3_OBLIGATIONS: readonly L3ObligationDefinition[] = Object.freeze([
  {
    nodeId: L3_FRAME_NODE_ID,
    id: L2_OBLIGATION_IDS.frameCompleted,
    duty: "required",
    title: "Frame completed",
    evaluatorJson: JSON.stringify({ kind: "frame-result" }),
  },
  {
    nodeId: L3_PLAN_NODE_ID,
    id: L3_OBLIGATION_IDS.planCompleted,
    duty: "required",
    title: "Plan completed",
    evaluatorJson: JSON.stringify({ kind: "plan-result" }),
  },
  {
    nodeId: L3_REVIEW_PLAN_NODE_ID,
    id: L3_OBLIGATION_IDS.feasibilityCompleted,
    duty: "required",
    title: "Feasibility review completed",
    evaluatorJson: JSON.stringify({ kind: "review-passed" }),
  },
  {
    nodeId: "execute-1",
    id: L1_OBLIGATION_IDS.requestedOutcomeProduced,
    duty: "required",
    title: "Requested outcome produced",
    evaluatorJson: JSON.stringify({ kind: "evidence-exists" }),
  },
  {
    nodeId: "execute-1",
    id: L1_OBLIGATION_IDS.minimumValidationRecorded,
    duty: "required",
    title: "Minimum validation recorded",
    evaluatorJson: JSON.stringify({
      kind: "evidence-type",
      type: "validation",
    }),
  },
  {
    nodeId: L3_REVIEW_EXECUTE_NODE_ID,
    id: L3_OBLIGATION_IDS.deliveryCompleted,
    duty: "required",
    title: "Delivery review completed",
    evaluatorJson: JSON.stringify({ kind: "review-passed" }),
  },
  {
    nodeId: L3_INTEGRATE_NODE_ID,
    id: L3_OBLIGATION_IDS.integrationCompleted,
    duty: "required",
    title: "Integration completed",
    evaluatorJson: JSON.stringify({ kind: "integrate-result" }),
  },
  {
    nodeId: L3_REVIEW_INTEGRATE_NODE_ID,
    id: L3_OBLIGATION_IDS.integrationReviewCompleted,
    duty: "required",
    title: "Integration review completed",
    evaluatorJson: JSON.stringify({ kind: "review-passed" }),
  },
  {
    nodeId: "record-1",
    id: L1_OBLIGATION_IDS.resultAndScopeRetained,
    duty: "required",
    title: "Result and scope retained",
    evaluatorJson: JSON.stringify({ kind: "record-result" }),
  },
]);
