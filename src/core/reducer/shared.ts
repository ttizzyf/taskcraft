// Low-level fact writers shared by the reducer commands: attempts, evidence,
// obligation results, audit events and the revision bump. All of these run
// inside the withTransaction provided by the command entry points.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getLastEventSeq } from "../../store/query.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";

export interface EventInput {
  taskId: string;
  lifecycleRevision: number;
  nodeId: string | null;
  attemptId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  postTaskRevision: number;
  actorInstanceId: string;
  host: string | null;
  occurredAt: string;
}

/** Appends one audit event. task_seq must be contiguous, which the
 * events_task_sequence_insert trigger enforces (taskSeq = last + 1). */
export function insertEvent(
  database: TaskcraftDatabase,
  input: EventInput,
): void {
  const taskSeq = getLastEventSeq(database, input.taskId) + 1;

  database
    .prepare(
      `INSERT INTO events (
         event_id, task_id, task_seq, lifecycle_revision, node_id, attempt_id,
         actor_instance_id, host, event_type, payload_json,
         post_task_revision, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `evt-${input.taskId}-${taskSeq}`,
      input.taskId,
      taskSeq,
      input.lifecycleRevision,
      input.nodeId,
      input.attemptId,
      input.actorInstanceId,
      input.host,
      input.eventType,
      JSON.stringify(input.payload),
      input.postTaskRevision,
      input.occurredAt,
    );
}

/** Advances the CAS revision and the updated_at timestamp. */
export function bumpRevision(
  database: TaskcraftDatabase,
  snapshot: TaskSnapshot,
  now: string,
): number {
  const nextRevision = snapshot.revision + 1;
  database
    .prepare("UPDATE tasks SET revision = ?, updated_at = ? WHERE id = ?")
    .run(nextRevision, now, snapshot.id);

  return nextRevision;
}

export function activateTask(
  database: TaskcraftDatabase,
  snapshot: TaskSnapshot,
  now: string,
): void {
  database
    .prepare("UPDATE tasks SET activated_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, snapshot.id);
}

export interface AttemptInput {
  id: string;
  taskId: string;
  lifecycleRevision: number;
  nodeId: string;
  attemptNumber: number;
  actorInstanceId: string;
  host: string;
  status: "created" | "running" | "finished" | "failed" | "cancelled";
  outcome: string | null;
  resultJson: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export function insertAttempt(
  database: TaskcraftDatabase,
  input: AttemptInput,
): void {
  database
    .prepare(
      `INSERT INTO node_attempts (
         id, task_id, lifecycle_revision, node_id, attempt_number,
         actor_instance_id, host, status, outcome, result_json, started_at,
         finished_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.taskId,
      input.lifecycleRevision,
      input.nodeId,
      input.attemptNumber,
      input.actorInstanceId,
      input.host,
      input.status,
      input.outcome,
      input.resultJson,
      input.startedAt,
      input.finishedAt,
    );
}

export function attemptId(
  taskId: string,
  nodeId: string,
  number: number,
): string {
  return `att-${taskId}-${nodeId}-${number}`;
}

export function finishAttempt(
  database: TaskcraftDatabase,
  attemptId: string,
  result: unknown,
  now: string,
): void {
  database
    .prepare(
      `UPDATE node_attempts SET status = 'finished', outcome = 'success',
              result_json = ?, finished_at = ? WHERE id = ?`,
    )
    .run(JSON.stringify(result), now, attemptId);
}

export interface EvidenceInput {
  id: string;
  taskId: string;
  attemptId: string;
  type: "validation" | "test" | "artifact" | "note";
  reference: string;
  summary: string;
  digest: string | null;
  actor: string;
  now: string;
}

/** Writes one evidence row bound to the owning attempt. The satisfied
 * obligation trigger requires the evidence to belong to an attempt of the
 * same node and revision, which callers guarantee by passing the target
 * attempt id. */
export function insertEvidence(
  database: TaskcraftDatabase,
  input: EvidenceInput,
): void {
  database
    .prepare(
      `INSERT INTO evidence (
         id, task_id, node_attempt_id, type, reference, summary, digest,
         created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.taskId,
      input.attemptId,
      input.type,
      input.reference,
      input.summary,
      input.digest,
      input.actor,
      input.now,
    );
}

/** Writes a satisfied obligation result. The evidence-owner trigger requires
 * the evidence to belong to an attempt of the same node and revision, which
 * the callers guarantee by binding evidence to the target attempt. An
 * obligation is satisfied at most once per revision (primary key): a
 * successor attempt in the changes_requested flow re-completes a node whose
 * obligations already hold, so a repeated satisfaction is a no-op. */
export function satisfyObligation(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  nodeId: string,
  obligationId: string,
  evidenceId: string,
  now: string,
): void {
  const existing = database
    .prepare(
      `SELECT 1 FROM obligation_results
       WHERE task_id = ? AND lifecycle_revision = ? AND node_id = ? AND obligation_id = ?`,
    )
    .get(taskId, snapshot.currentLifecycleRevision, nodeId, obligationId);

  if (existing !== undefined) {
    return;
  }

  database
    .prepare(
      `INSERT INTO obligation_results (
         task_id, lifecycle_revision, node_id, obligation_id, status,
         satisfied_by_evidence_id, skip_reason, updated_at
       ) VALUES (?, ?, ?, ?, 'satisfied', ?, NULL, ?)`,
    )
    .run(
      taskId,
      snapshot.currentLifecycleRevision,
      nodeId,
      obligationId,
      evidenceId,
      now,
    );
}

export function isUniqueConstraint(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}
