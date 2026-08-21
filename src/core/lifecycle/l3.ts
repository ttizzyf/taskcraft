// L3 is compiled in two immutable revisions. A new task starts with the
// planning graph. Passing its feasibility review atomically creates either a
// modules execution graph (real child tasks gate Integrate) or a single-task
// execution graph. Historical tc-l3/1 revisions stay readable from SQLite.

import {
  L1_EXECUTE_RESULT_SCHEMA,
  L1_FACTS_DIGEST,
  L1_OBLIGATION_IDS,
  L1_POLICY_DIGEST,
  L1_RECORD_RESULT_SCHEMA,
} from "./l1.js";
import { L2_OBLIGATION_IDS } from "./l2.js";
import {
  L3_FRAME_RESULT_SCHEMA,
  L3_INTEGRATE_RESULT_SCHEMA,
  L3_PLAN_RESULT_SCHEMA,
} from "./l3-schemas.js";

export {
  L3_FRAME_RESULT_SCHEMA,
  L3_INTEGRATE_RESULT_SCHEMA,
  L3_PLAN_RESULT_SCHEMA,
} from "./l3-schemas.js";

export const L3_COMPILER_VERSION = "tc-l3/3";
export const L3_CHILD_COMPILER_VERSION = "tc-l3-child/2";
export const L3_LEGACY_MODULAR_COMPILER_VERSION = "tc-l3/2";
export const L3_LEGACY_CHILD_COMPILER_VERSION = "tc-l3-child/1";

export function isModularL3CompilerVersion(version: string): boolean {
  return (
    version === L3_COMPILER_VERSION ||
    version === L3_LEGACY_MODULAR_COMPILER_VERSION
  );
}
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

export interface L3NodeDefinition {
  id: string;
  kind: "frame" | "plan" | "execute" | "review" | "integrate" | "record";
  title: string;
  procedureRef: string;
  outputSchemaJson: string;
}

const FRAME_NODE: L3NodeDefinition = {
  id: L3_FRAME_NODE_ID,
  kind: "frame",
  title: "Frame",
  procedureRef: "l3:frame",
  outputSchemaJson: JSON.stringify(L3_FRAME_RESULT_SCHEMA),
};
const PLAN_NODE: L3NodeDefinition = {
  id: L3_PLAN_NODE_ID,
  kind: "plan",
  title: "Plan",
  procedureRef: "l3:plan",
  outputSchemaJson: JSON.stringify(L3_PLAN_RESULT_SCHEMA),
};
const FEASIBILITY_NODE: L3NodeDefinition = {
  id: L3_REVIEW_PLAN_NODE_ID,
  kind: "review",
  title: "Feasibility review",
  procedureRef: "l3:review",
  outputSchemaJson: "{}",
};
const EXECUTE_NODE: L3NodeDefinition = {
  id: "execute-1",
  kind: "execute",
  title: "Execute",
  procedureRef: "l3:execute",
  outputSchemaJson: JSON.stringify(L1_EXECUTE_RESULT_SCHEMA),
};
const DELIVERY_REVIEW_NODE: L3NodeDefinition = {
  id: L3_REVIEW_EXECUTE_NODE_ID,
  kind: "review",
  title: "Delivery review",
  procedureRef: "l3:review",
  outputSchemaJson: "{}",
};
const INTEGRATE_NODE: L3NodeDefinition = {
  id: L3_INTEGRATE_NODE_ID,
  kind: "integrate",
  title: "Integrate",
  procedureRef: "l3:integrate",
  outputSchemaJson: JSON.stringify(L3_INTEGRATE_RESULT_SCHEMA),
};
const INTEGRATION_REVIEW_NODE: L3NodeDefinition = {
  id: L3_REVIEW_INTEGRATE_NODE_ID,
  kind: "review",
  title: "Integration review",
  procedureRef: "l3:review",
  outputSchemaJson: "{}",
};
const RECORD_NODE: L3NodeDefinition = {
  id: "record-1",
  kind: "record",
  title: "Record",
  procedureRef: "l3:record",
  outputSchemaJson: JSON.stringify(L1_RECORD_RESULT_SCHEMA),
};

export const L3_PLANNING_NODES = Object.freeze([
  FRAME_NODE,
  PLAN_NODE,
  FEASIBILITY_NODE,
]);
export const L3_MODULES_EXECUTION_NODES = Object.freeze([
  INTEGRATE_NODE,
  INTEGRATION_REVIEW_NODE,
  RECORD_NODE,
]);
export const L3_SINGLE_EXECUTION_NODES = Object.freeze([
  EXECUTE_NODE,
  DELIVERY_REVIEW_NODE,
  INTEGRATE_NODE,
  INTEGRATION_REVIEW_NODE,
  RECORD_NODE,
]);

export const L3_PLANNING_EDGES = Object.freeze([
  { fromNodeId: L3_FRAME_NODE_ID, toNodeId: L3_PLAN_NODE_ID },
  { fromNodeId: L3_PLAN_NODE_ID, toNodeId: L3_REVIEW_PLAN_NODE_ID },
]);
export const L3_MODULES_EXECUTION_EDGES = Object.freeze([
  { fromNodeId: L3_INTEGRATE_NODE_ID, toNodeId: L3_REVIEW_INTEGRATE_NODE_ID },
  { fromNodeId: L3_REVIEW_INTEGRATE_NODE_ID, toNodeId: "record-1" },
]);
export const L3_SINGLE_EXECUTION_EDGES = Object.freeze([
  { fromNodeId: "execute-1", toNodeId: L3_REVIEW_EXECUTE_NODE_ID },
  { fromNodeId: L3_REVIEW_EXECUTE_NODE_ID, toNodeId: L3_INTEGRATE_NODE_ID },
  ...L3_MODULES_EXECUTION_EDGES,
]);

export interface L3ObligationDefinition {
  nodeId: string;
  id: string;
  duty: "required";
  title: string;
  evaluatorJson: string;
}

const EXECUTE_OBLIGATIONS: readonly L3ObligationDefinition[] = [
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
];
const INTEGRATION_OBLIGATIONS: readonly L3ObligationDefinition[] = [
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
];

export const L3_PLANNING_OBLIGATIONS = Object.freeze([
  {
    nodeId: L3_FRAME_NODE_ID,
    id: L2_OBLIGATION_IDS.frameCompleted,
    duty: "required" as const,
    title: "Frame completed",
    evaluatorJson: JSON.stringify({ kind: "frame-result" }),
  },
  {
    nodeId: L3_PLAN_NODE_ID,
    id: L3_OBLIGATION_IDS.planCompleted,
    duty: "required" as const,
    title: "Plan completed",
    evaluatorJson: JSON.stringify({ kind: "plan-result" }),
  },
  {
    nodeId: L3_REVIEW_PLAN_NODE_ID,
    id: L3_OBLIGATION_IDS.feasibilityCompleted,
    duty: "required" as const,
    title: "Feasibility review completed",
    evaluatorJson: JSON.stringify({ kind: "review-passed" }),
  },
]);
export const L3_MODULES_EXECUTION_OBLIGATIONS = Object.freeze([
  ...INTEGRATION_OBLIGATIONS,
]);
export const L3_SINGLE_EXECUTION_OBLIGATIONS = Object.freeze([
  ...EXECUTE_OBLIGATIONS,
  {
    nodeId: L3_REVIEW_EXECUTE_NODE_ID,
    id: L3_OBLIGATION_IDS.deliveryCompleted,
    duty: "required" as const,
    title: "Delivery review completed",
    evaluatorJson: JSON.stringify({ kind: "review-passed" }),
  },
  ...INTEGRATION_OBLIGATIONS,
]);

// Backward-compatible imports inside the codebase now point at the planning
// compiler. They do not preserve the old tc-l3/1 graph shape.
export const L3_NODES = L3_PLANNING_NODES;
export const L3_EDGES = L3_PLANNING_EDGES;
export const L3_OBLIGATIONS = L3_PLANNING_OBLIGATIONS;
