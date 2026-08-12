// Materializes the L3 lifecycle graph into the four definition tables for a
// given revision. Used by taskNew (revision 1) and reviewReplan (new
// revision); the node ids stay stable across revisions so old facts remain
// queryable and the projector only looks at the current revision. Also hosts
// the plan/integrate result validators shared by run complete.

import {
  Ajv2020,
  type AnySchema,
  type ValidateFunction,
} from "ajv/dist/2020.js";

import type { TaskcraftDatabase } from "../../store/database.js";
import {
  L3_EDGES,
  L3_INTEGRATE_RESULT_SCHEMA,
  L3_NODES,
  L3_OBLIGATIONS,
  L3_PLAN_RESULT_SCHEMA,
} from "../lifecycle/l3.js";

export interface L3GraphInput {
  taskId: string;
  revision: number;
  reasonCode: string;
  reason: string;
  compilerVersion: string;
  factsDigest: string;
  policyDigest: string;
  changeSummary: Record<string, unknown>;
  objective: string;
  actor: string;
  now: string;
}

export function materializeL3Graph(
  database: TaskcraftDatabase,
  input: L3GraphInput,
): void {
  database
    .prepare(
      `INSERT INTO lifecycle_revisions (
         task_id, revision, reason_code, reason, compiler_version,
         facts_digest, policy_digest, change_summary_json, created_by,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.taskId,
      input.revision,
      input.reasonCode,
      input.reason,
      input.compilerVersion,
      input.factsDigest,
      input.policyDigest,
      JSON.stringify(input.changeSummary),
      input.actor,
      input.now,
    );

  const insertNode = database.prepare(
    `INSERT INTO lifecycle_nodes (
       task_id, lifecycle_revision, id, kind, title, objective,
       procedure_ref, scope_json, entry_gate_json, exit_gate_json,
       retry_policy_json, input_schema_json, output_schema_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '{}', '{}', ?, '{}', ?)`,
  );
  for (const node of L3_NODES) {
    insertNode.run(
      input.taskId,
      input.revision,
      node.id,
      node.kind,
      node.title,
      input.objective,
      node.procedureRef,
      JSON.stringify(node.kind === "review" ? {} : { maxRetries: 3 }),
      node.outputSchemaJson,
    );
  }

  const insertEdge = database.prepare(
    `INSERT INTO lifecycle_edges (
       task_id, lifecycle_revision, from_node_id, to_node_id,
       condition_json, label
     ) VALUES (?, ?, ?, ?, '{"kind":"always"}', NULL)`,
  );
  for (const edge of L3_EDGES) {
    insertEdge.run(
      input.taskId,
      input.revision,
      edge.fromNodeId,
      edge.toNodeId,
    );
  }

  const insertObligation = database.prepare(
    `INSERT INTO obligation_definitions (
       task_id, lifecycle_revision, node_id, id, duty, title, evaluator_json
     ) VALUES (?, ?, ?, ?, 'required', ?, ?)`,
  );
  for (const obligation of L3_OBLIGATIONS) {
    insertObligation.run(
      input.taskId,
      input.revision,
      obligation.nodeId,
      obligation.id,
      obligation.title,
      obligation.evaluatorJson,
    );
  }
}

let planResultValidator: ValidateFunction | null = null;
let integrateResultValidator: ValidateFunction | null = null;

export function validatePlanResult(result: unknown): boolean {
  if (planResultValidator === null) {
    planResultValidator = new Ajv2020({
      strict: true,
      allErrors: true,
    }).compile(L3_PLAN_RESULT_SCHEMA as AnySchema);
  }

  return planResultValidator(result) === true;
}

export function validateIntegrateResult(result: unknown): boolean {
  if (integrateResultValidator === null) {
    integrateResultValidator = new Ajv2020({
      strict: true,
      allErrors: true,
    }).compile(L3_INTEGRATE_RESULT_SCHEMA as AnySchema);
  }

  return integrateResultValidator(result) === true;
}
