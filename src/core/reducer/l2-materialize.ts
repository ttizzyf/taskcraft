// Materializes the L2 lifecycle graph into the four definition tables for a
// given revision. Used by taskNew (revision 1) and reviewReplan (new
// revision); the node ids stay stable across revisions so old facts remain
// queryable and the projector only looks at the current revision.

import {
  Ajv2020,
  type AnySchema,
  type ValidateFunction,
} from "ajv/dist/2020.js";

import type { TaskcraftDatabase } from "../../store/database.js";
import {
  L2_EDGES,
  L2_FRAME_RESULT_SCHEMA,
  L2_NODES,
  L2_OBLIGATIONS,
  L2_REVIEW_NODE_ID,
} from "../lifecycle/l2.js";

export interface L2GraphInput {
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

export function materializeL2Graph(
  database: TaskcraftDatabase,
  input: L2GraphInput,
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
  for (const node of L2_NODES) {
    insertNode.run(
      input.taskId,
      input.revision,
      node.id,
      node.kind,
      node.title,
      input.objective,
      node.procedureRef,
      JSON.stringify(node.id === L2_REVIEW_NODE_ID ? {} : { maxRetries: 3 }),
      node.outputSchemaJson,
    );
  }

  const insertEdge = database.prepare(
    `INSERT INTO lifecycle_edges (
       task_id, lifecycle_revision, from_node_id, to_node_id,
       condition_json, label
     ) VALUES (?, ?, ?, ?, '{"kind":"always"}', NULL)`,
  );
  for (const edge of L2_EDGES) {
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
  for (const obligation of L2_OBLIGATIONS) {
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

let frameResultValidator: ValidateFunction | null = null;

export function validateFrameResult(result: unknown): boolean {
  if (frameResultValidator === null) {
    frameResultValidator = new Ajv2020({
      strict: true,
      allErrors: true,
    }).compile(L2_FRAME_RESULT_SCHEMA as AnySchema);
  }

  return frameResultValidator(result) === true;
}
