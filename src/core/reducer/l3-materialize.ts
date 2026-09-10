// L3 lifecycle compiler. Planning, modules
// execution and single execution graphs are separate immutable revisions.

import type { TaskcraftDatabase } from "../../store/database.js";
import {
  L3_MODULES_EXECUTION_EDGES,
  L3_MODULES_EXECUTION_NODES,
  L3_MODULES_EXECUTION_OBLIGATIONS,
  L3_PLANNING_EDGES,
  L3_PLANNING_NODES,
  L3_PLANNING_OBLIGATIONS,
  L3_SINGLE_EXECUTION_EDGES,
  L3_SINGLE_EXECUTION_NODES,
  L3_SINGLE_EXECUTION_OBLIGATIONS,
  l3NodesForCompiler,
  l3ObligationsForCompiler,
  type L3NodeDefinition,
  type L3ObligationDefinition,
} from "../lifecycle/l3.js";

export type L3GraphKind = "planning" | "modules" | "single";

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
  kind?: L3GraphKind;
}

export function materializeL3Graph(
  database: TaskcraftDatabase,
  input: L3GraphInput,
): void {
  const definition = graphDefinition(
    input.kind ?? "planning",
    input.compilerVersion,
  );

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
      JSON.stringify({ ...input.changeSummary, l3GraphKind: definition.kind }),
      input.actor,
      input.now,
    );

  insertNodes(database, input, definition.nodes);
  insertEdges(database, input, definition.edges);
  insertObligations(database, input, definition.obligations);
}

function graphDefinition(
  kind: L3GraphKind,
  compilerVersion: string,
): {
  kind: L3GraphKind;
  nodes: readonly L3NodeDefinition[];
  edges: readonly { fromNodeId: string; toNodeId: string }[];
  obligations: readonly L3ObligationDefinition[];
} {
  switch (kind) {
    case "planning":
      return {
        kind,
        nodes: l3NodesForCompiler(L3_PLANNING_NODES, compilerVersion),
        edges: L3_PLANNING_EDGES,
        obligations: l3ObligationsForCompiler(
          L3_PLANNING_OBLIGATIONS,
          compilerVersion,
        ),
      };
    case "modules":
      return {
        kind,
        nodes: l3NodesForCompiler(L3_MODULES_EXECUTION_NODES, compilerVersion),
        edges: L3_MODULES_EXECUTION_EDGES,
        obligations: l3ObligationsForCompiler(
          L3_MODULES_EXECUTION_OBLIGATIONS,
          compilerVersion,
        ),
      };
    case "single":
      return {
        kind,
        nodes: l3NodesForCompiler(L3_SINGLE_EXECUTION_NODES, compilerVersion),
        edges: L3_SINGLE_EXECUTION_EDGES,
        obligations: l3ObligationsForCompiler(
          L3_SINGLE_EXECUTION_OBLIGATIONS,
          compilerVersion,
        ),
      };
  }
}

function insertNodes(
  database: TaskcraftDatabase,
  input: L3GraphInput,
  nodes: readonly L3NodeDefinition[],
): void {
  const insertNode = database.prepare(
    `INSERT INTO lifecycle_nodes (
       task_id, lifecycle_revision, id, kind, title, objective,
       procedure_ref, scope_json, entry_gate_json, exit_gate_json,
       retry_policy_json, input_schema_json, output_schema_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '{}', '{}', ?, '{}', ?)`,
  );

  for (const node of nodes) {
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
}

function insertEdges(
  database: TaskcraftDatabase,
  input: L3GraphInput,
  edges: readonly { fromNodeId: string; toNodeId: string }[],
): void {
  const insertEdge = database.prepare(
    `INSERT INTO lifecycle_edges (
       task_id, lifecycle_revision, from_node_id, to_node_id,
       condition_json, label
     ) VALUES (?, ?, ?, ?, '{"kind":"always"}', NULL)`,
  );

  for (const edge of edges) {
    insertEdge.run(
      input.taskId,
      input.revision,
      edge.fromNodeId,
      edge.toNodeId,
    );
  }
}

function insertObligations(
  database: TaskcraftDatabase,
  input: L3GraphInput,
  obligations: readonly L3ObligationDefinition[],
): void {
  const insertObligation = database.prepare(
    `INSERT INTO obligation_definitions (
       task_id, lifecycle_revision, node_id, id, duty, title, evaluator_json
     ) VALUES (?, ?, ?, ?, 'required', ?, ?)`,
  );

  for (const obligation of obligations) {
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
