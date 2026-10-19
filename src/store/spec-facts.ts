import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import {
  assertResolvedBindings,
  type ResolvedSpecBinding,
} from "../spec/bindings.js";
import type { TaskcraftDatabase } from "./database.js";

export type SpecBindingSourceKind =
  "task_create" | "frame" | "accepted_plan" | "inherited_plan" | "refresh";

export interface LifecycleSpecBindingRow {
  taskId: string;
  lifecycleRevision: number;
  nodeId: string;
  specId: string;
  specKind: "engineering" | "domain";
  specPath: string;
  duty: "required" | "recommended";
  sourceKind: SpecBindingSourceKind;
  sourceTaskId: string | null;
  sourceAttemptId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface SpecImpactResultRow {
  recordAttemptId: string;
  taskId: string;
  lifecycleRevision: number;
  recordNodeId: string;
  outcome: "none" | "updated" | "candidate";
  detailsJson: string;
  createdBy: string;
  createdAt: string;
}

type BindingSource =
  | { kind: "task_create" | "refresh" }
  | {
      kind: "frame" | "accepted_plan" | "inherited_plan";
      taskId: string;
      attemptId: string;
    };

export interface InsertSpecBindingsInput {
  taskId: string;
  lifecycleRevision: number;
  nodeIds: readonly string[];
  bindings: readonly ResolvedSpecBinding[];
  source: BindingSource;
  actor: string;
  now: string;
}

/** Appends the same confirmed Spec set to every named node. Callers own the
 * surrounding reducer transaction so graph/binding writes commit atomically. */
export function insertLifecycleSpecBindings(
  database: TaskcraftDatabase,
  input: InsertSpecBindingsInput,
): void {
  assertResolvedBindings(input.bindings, "Lifecycle Spec bindings");
  assertBindingTarget(database, input);
  assertBindingSource(database, input);

  const insert = database.prepare(
    `INSERT INTO lifecycle_spec_bindings (
       task_id, lifecycle_revision, node_id, spec_id, spec_kind, spec_path,
       duty, source_kind, source_task_id, source_attempt_id,
       created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const nodeId of input.nodeIds) {
    for (const binding of input.bindings) {
      insert.run(
        input.taskId,
        input.lifecycleRevision,
        nodeId,
        binding.specId,
        binding.kind,
        binding.path,
        binding.duty,
        input.source.kind,
        "taskId" in input.source ? input.source.taskId : null,
        "attemptId" in input.source ? input.source.attemptId : null,
        input.actor,
        input.now,
      );
    }
  }
}

export function getLifecycleSpecBindings(
  database: TaskcraftDatabase,
  taskId: string,
  revision?: number,
  nodeId?: string,
): LifecycleSpecBindingRow[] {
  const conditions = ["task_id = ?"];
  const parameters: Array<string | number> = [taskId];
  if (revision !== undefined) {
    conditions.push("lifecycle_revision = ?");
    parameters.push(revision);
  }
  if (nodeId !== undefined) {
    conditions.push("node_id = ?");
    parameters.push(nodeId);
  }
  return database
    .prepare(
      `SELECT task_id AS taskId, lifecycle_revision AS lifecycleRevision,
              node_id AS nodeId, spec_id AS specId, spec_kind AS specKind,
              spec_path AS specPath, duty,
              source_kind AS sourceKind, source_task_id AS sourceTaskId,
              source_attempt_id AS sourceAttemptId, created_by AS createdBy,
              created_at AS createdAt
       FROM lifecycle_spec_bindings
       WHERE ${conditions.join(" AND ")}
       ORDER BY lifecycle_revision, node_id, spec_id`,
    )
    .all(...parameters) as LifecycleSpecBindingRow[];
}

export interface InsertSpecImpactInput {
  recordAttemptId: string;
  taskId: string;
  lifecycleRevision: number;
  recordNodeId: string;
  outcome: "none" | "updated" | "candidate";
  details: Record<string, unknown>;
  actor: string;
  now: string;
}

export function insertSpecImpactResult(
  database: TaskcraftDatabase,
  input: InsertSpecImpactInput,
): void {
  if (
    input.recordAttemptId.trim() === "" ||
    input.recordNodeId.trim() === "" ||
    input.actor.trim() === "" ||
    !Number.isInteger(input.lifecycleRevision) ||
    input.lifecycleRevision < 1 ||
    !["none", "updated", "candidate"].includes(input.outcome)
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_SPEC_IMPACT_INVALID, {
      problem: "Spec Impact result is not a valid Record-attempt fact",
      impact: "No Spec Impact fact was written",
      remediation:
        "Submit a typed Spec Impact result for the current Record attempt",
      context: { taskId: input.taskId },
    });
  }
  database
    .prepare(
      `INSERT INTO spec_impact_results (
         record_attempt_id, task_id, lifecycle_revision, record_node_id,
         outcome, details_json, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.recordAttemptId,
      input.taskId,
      input.lifecycleRevision,
      input.recordNodeId,
      input.outcome,
      JSON.stringify(input.details),
      input.actor,
      input.now,
    );
}

export function getSpecImpactResults(
  database: TaskcraftDatabase,
  taskId: string,
  revision?: number,
): SpecImpactResultRow[] {
  return (
    revision === undefined
      ? database
          .prepare(
            `SELECT record_attempt_id AS recordAttemptId, task_id AS taskId,
                  lifecycle_revision AS lifecycleRevision,
                  record_node_id AS recordNodeId, outcome,
                  details_json AS detailsJson, created_by AS createdBy,
                  created_at AS createdAt
           FROM spec_impact_results WHERE task_id = ?
           ORDER BY lifecycle_revision, created_at, record_attempt_id`,
          )
          .all(taskId)
      : database
          .prepare(
            `SELECT record_attempt_id AS recordAttemptId, task_id AS taskId,
                  lifecycle_revision AS lifecycleRevision,
                  record_node_id AS recordNodeId, outcome,
                  details_json AS detailsJson, created_by AS createdBy,
                  created_at AS createdAt
           FROM spec_impact_results
           WHERE task_id = ? AND lifecycle_revision = ?
           ORDER BY created_at, record_attempt_id`,
          )
          .all(taskId, revision)
  ) as SpecImpactResultRow[];
}

function assertBindingTarget(
  database: TaskcraftDatabase,
  input: InsertSpecBindingsInput,
): void {
  const uniqueNodes = new Set(input.nodeIds);
  if (
    input.taskId.trim() === "" ||
    !Number.isInteger(input.lifecycleRevision) ||
    input.lifecycleRevision < 1 ||
    input.actor.trim() === "" ||
    uniqueNodes.size !== input.nodeIds.length ||
    input.nodeIds.some((nodeId) => nodeId.trim() === "")
  ) {
    throw bindingInvalid(input.taskId, "Binding target is malformed");
  }
  if (input.bindings.length === 0 || input.nodeIds.length === 0) return;
  const rows = database
    .prepare(
      `SELECT id FROM lifecycle_nodes
       WHERE task_id = ? AND lifecycle_revision = ?`,
    )
    .all(input.taskId, input.lifecycleRevision) as Array<{ id: string }>;
  const existing = new Set(rows.map((row) => row.id));
  const unknown = input.nodeIds.filter((nodeId) => !existing.has(nodeId));
  if (unknown.length > 0) {
    throw bindingInvalid(
      input.taskId,
      `Binding targets unknown lifecycle nodes: ${unknown.join(", ")}`,
    );
  }
}

function assertBindingSource(
  database: TaskcraftDatabase,
  input: InsertSpecBindingsInput,
): void {
  if (input.source.kind === "task_create") {
    if (input.lifecycleRevision !== 1) {
      throw bindingInvalid(
        input.taskId,
        "task_create bindings must target lifecycle revision 1",
      );
    }
    return;
  }
  if (input.source.kind === "refresh") {
    if (input.lifecycleRevision <= 1) {
      throw bindingInvalid(
        input.taskId,
        "refresh bindings must target a later lifecycle revision",
      );
    }
    return;
  }
  const source = input.source as Extract<
    BindingSource,
    { kind: "frame" | "accepted_plan" | "inherited_plan" }
  >;
  const row = database
    .prepare(
      `SELECT attempt.task_id AS taskId,
              attempt.lifecycle_revision AS lifecycleRevision, node.kind
       FROM node_attempts AS attempt
       JOIN lifecycle_nodes AS node
         ON node.task_id = attempt.task_id
        AND node.lifecycle_revision = attempt.lifecycle_revision
        AND node.id = attempt.node_id
       WHERE attempt.id = ? AND attempt.task_id = ?`,
    )
    .get(source.attemptId, source.taskId) as
    { taskId: string; lifecycleRevision: number; kind: string } | undefined;
  const validFrame =
    input.source.kind === "frame" &&
    row?.kind === "frame" &&
    row.taskId === input.taskId &&
    row.lifecycleRevision === input.lifecycleRevision;
  const validAcceptedPlan =
    input.source.kind === "accepted_plan" &&
    row?.kind === "plan" &&
    source.taskId === input.taskId &&
    database
      .prepare(
        `SELECT 1 FROM lifecycle_execution_sources
         WHERE task_id = ? AND lifecycle_revision = ?
           AND source_plan_attempt_id = ?`,
      )
      .get(input.taskId, input.lifecycleRevision, source.attemptId) !==
      undefined;
  const validInheritedPlan =
    input.source.kind === "inherited_plan" &&
    row?.kind === "plan" &&
    database
      .prepare(
        `SELECT 1 FROM lifecycle_inherited_planning
         WHERE child_task_id = ? AND child_lifecycle_revision = ?
           AND parent_task_id = ? AND source_plan_attempt_id = ?`,
      )
      .get(
        input.taskId,
        input.lifecycleRevision,
        source.taskId,
        source.attemptId,
      ) !== undefined;
  if (!(validFrame || validAcceptedPlan || validInheritedPlan)) {
    throw bindingInvalid(
      input.taskId,
      `Binding source ${source.attemptId} is not the required ${input.source.kind} provenance`,
    );
  }
}

function bindingInvalid(taskId: string, problem: string): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_SPEC_BINDING_INVALID, {
    problem,
    impact: "No lifecycle Spec facts were written",
    remediation: `Inspect the lifecycle and retry the binding command for ${taskId}`,
    context: { taskId },
  });
}
