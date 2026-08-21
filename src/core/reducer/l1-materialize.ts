import type { TaskcraftDatabase } from "../../store/database.js";
import {
  L1_COMPILER_VERSION,
  L1_EDGE,
  L1_FACTS_DIGEST,
  L1_NODES,
  L1_OBLIGATIONS,
  L1_POLICY_DIGEST,
} from "../lifecycle/l1.js";

export interface L1GraphInput {
  taskId: string;
  revision: number;
  reasonCode: string;
  reason: string;
  changeSummary: Record<string, unknown>;
  objective: string;
  actor: string;
  now: string;
  compilerVersion?: string;
}

export function materializeL1Graph(
  database: TaskcraftDatabase,
  input: L1GraphInput,
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
      input.compilerVersion ?? L1_COMPILER_VERSION,
      L1_FACTS_DIGEST,
      L1_POLICY_DIGEST,
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
  for (const node of L1_NODES) {
    insertNode.run(
      input.taskId,
      input.revision,
      node.id,
      node.kind,
      node.title,
      input.objective,
      node.procedureRef,
      JSON.stringify({ maxRetries: 3 }),
      node.outputSchemaJson,
    );
  }

  database
    .prepare(
      `INSERT INTO lifecycle_edges (
         task_id, lifecycle_revision, from_node_id, to_node_id,
         condition_json, label
       ) VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      input.taskId,
      input.revision,
      L1_EDGE.fromNodeId,
      L1_EDGE.toNodeId,
      L1_EDGE.conditionJson,
    );

  const insertObligation = database.prepare(
    `INSERT INTO obligation_definitions (
       task_id, lifecycle_revision, node_id, id, duty, title, evaluator_json
     ) VALUES (?, ?, ?, ?, 'required', ?, ?)`,
  );
  for (const obligation of L1_OBLIGATIONS) {
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
