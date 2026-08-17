// Compiles inherited L1/L2 child execution graphs. Planning provenance is
// stored separately; no fake Frame/Plan host attempts are created.

import type { TaskcraftDatabase } from "../../store/database.js";
import { L1_EDGE, L1_NODES, L1_OBLIGATIONS } from "../lifecycle/l1.js";
import { L2_EDGES, L2_NODES, L2_OBLIGATIONS } from "../lifecycle/l2.js";
import { L3_CHILD_COMPILER_VERSION } from "../lifecycle/l3.js";

export interface InheritedChildGraphInput {
  taskId: string;
  level: 1 | 2;
  objective: string;
  parentTaskId: string;
  parentLifecycleRevision: number;
  moduleKey: string;
  sourcePlanAttemptId: string;
  factsDigest: string;
  policyDigest: string;
  actor: string;
  now: string;
}

export function materializeInheritedChildLifecycle(
  database: TaskcraftDatabase,
  input: InheritedChildGraphInput,
): void {
  const nodes =
    input.level === 1
      ? L1_NODES
      : L2_NODES.filter((node) => node.kind !== "frame");
  const edges =
    input.level === 1
      ? [L1_EDGE]
      : L2_EDGES.filter((edge) => edge.fromNodeId !== "frame-1");
  const obligations =
    input.level === 1
      ? L1_OBLIGATIONS
      : L2_OBLIGATIONS.filter((obligation) => obligation.nodeId !== "frame-1");

  database
    .prepare(
      `INSERT INTO lifecycle_revisions (
         task_id, revision, reason_code, reason, compiler_version,
         facts_digest, policy_digest, change_summary_json, created_by,
         created_at
       ) VALUES (?, 1, 'initial', 'inherited L3 module plan', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.taskId,
      L3_CHILD_COMPILER_VERSION,
      input.factsDigest,
      input.policyDigest,
      JSON.stringify({
        inheritedPlanning: true,
        parentTaskId: input.parentTaskId,
        parentLifecycleRevision: input.parentLifecycleRevision,
        moduleKey: input.moduleKey,
        sourcePlanAttemptId: input.sourcePlanAttemptId,
      }),
      input.actor,
      input.now,
    );

  const insertNode = database.prepare(
    `INSERT INTO lifecycle_nodes (
       task_id, lifecycle_revision, id, kind, title, objective,
       procedure_ref, scope_json, entry_gate_json, exit_gate_json,
       retry_policy_json, input_schema_json, output_schema_json
     ) VALUES (?, 1, ?, ?, ?, ?, ?, '{}', '{}', '{}', ?, '{}', ?)`,
  );
  for (const node of nodes) {
    insertNode.run(
      input.taskId,
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
     ) VALUES (?, 1, ?, ?, '{"kind":"always"}', NULL)`,
  );
  for (const edge of edges) {
    insertEdge.run(input.taskId, edge.fromNodeId, edge.toNodeId);
  }

  const insertObligation = database.prepare(
    `INSERT INTO obligation_definitions (
       task_id, lifecycle_revision, node_id, id, duty, title, evaluator_json
     ) VALUES (?, 1, ?, ?, 'required', ?, ?)`,
  );
  for (const obligation of obligations) {
    insertObligation.run(
      input.taskId,
      obligation.nodeId,
      obligation.id,
      obligation.title,
      obligation.evaluatorJson,
    );
  }
}
