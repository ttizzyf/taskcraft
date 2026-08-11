// runComplete: validates the execute result against the L1 schema (no facts
// are written on failure), binds the evidence to the target attempt, closes
// the attempt and satisfies the execute obligations. A record segment in the
// result satisfies the record obligation in the same transaction.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getAttempts } from "../../store/query.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import {
  L1_DEFAULT_ACTOR,
  L1_EXECUTE_NODE_ID,
  L1_OBLIGATION_IDS,
  L1_RECORD_NODE_ID,
} from "../lifecycle/l1.js";
import type {
  CommandData,
  ExecuteResult,
  RunCompleteInput,
} from "./context.js";
import {
  assertNotCancelled,
  commandData,
  requiredObligationError,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import {
  attemptId,
  bumpRevision,
  finishAttempt,
  insertAttempt,
  insertEvent,
  nowIso,
  satisfyObligation,
  validateExecuteResult,
} from "./shared.js";

export function runComplete(
  database: TaskcraftDatabase,
  taskId: string,
  input: RunCompleteInput,
): CommandData {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);
    const result = input.result as ExecuteResult;

    if (!validateExecuteResult(result)) {
      throw new TaskcraftError(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID, {
        problem: `Result for ${L1_EXECUTE_NODE_ID} failed the node result schema`,
        impact: "No facts were written; the task keeps its current state",
        remediation:
          "Resubmit a result matching the execute-1 result schema from the Node Brief",
        context: { taskId },
      });
    }

    const attempt = resolveTargetAttempt(
      database,
      taskId,
      snapshot,
      input.attemptId,
    );

    if (result.evidence.length === 0) {
      throw requiredObligationError(
        taskId,
        L1_OBLIGATION_IDS.requestedOutcomeProduced,
      );
    }

    const validationEvidence = result.evidence.find(
      (evidence) => evidence.type === "validation",
    );

    if (validationEvidence === undefined) {
      throw requiredObligationError(
        taskId,
        L1_OBLIGATION_IDS.minimumValidationRecorded,
      );
    }

    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const now = nowIso();
    const evidenceIds = result.evidence.map((evidence, index) => {
      const id = `ev-${taskId}-${attempt.id}-${index + 1}`;
      database
        .prepare(
          `INSERT INTO evidence (
             id, task_id, node_attempt_id, type, reference, summary, digest,
             created_by, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          taskId,
          attempt.id,
          evidence.type,
          evidence.reference,
          evidence.summary,
          evidence.digest ?? null,
          actor,
          now,
        );
      return id;
    });

    finishAttempt(database, attempt.id, result, now);
    satisfyObligation(
      database,
      taskId,
      snapshot,
      L1_EXECUTE_NODE_ID,
      L1_OBLIGATION_IDS.requestedOutcomeProduced,
      evidenceIds[0]!,
      now,
    );
    satisfyObligation(
      database,
      taskId,
      snapshot,
      L1_EXECUTE_NODE_ID,
      L1_OBLIGATION_IDS.minimumValidationRecorded,
      evidenceIds[result.evidence.indexOf(validationEvidence)]!,
      now,
    );

    if (result.record !== undefined) {
      writeRecordResult(database, taskId, snapshot, result.record, actor, now);
    }

    insertEvent(database, {
      taskId,
      lifecycleRevision: snapshot.currentLifecycleRevision,
      nodeId: attempt.nodeId,
      attemptId: attempt.id,
      eventType: "attempt.finished",
      payload: { outcome: "success" },
      postTaskRevision: snapshot.revision + 1,
      actorInstanceId: actor,
      host: attempt.host,
      occurredAt: now,
    });
    bumpRevision(database, snapshot, now);

    return commandData(database, taskId, snapshotOf(database, taskId));
  });
}

/** Picks the attempt to close: the caller's attemptId (validated against the
 * current revision and node) or the active execute-1 attempt. */
function resolveTargetAttempt(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  expectedAttemptId: string | undefined,
) {
  const attempts = getAttempts(database, taskId).filter(
    (attempt) =>
      attempt.lifecycleRevision === snapshot.currentLifecycleRevision,
  );
  const attempt = expectedAttemptId
    ? attempts.find((candidate) => candidate.id === expectedAttemptId)
    : attempts.find(
        (candidate) =>
          candidate.nodeId === L1_EXECUTE_NODE_ID &&
          (candidate.status === "created" || candidate.status === "running"),
      );

  if (
    attempt === undefined ||
    attempt.nodeId !== L1_EXECUTE_NODE_ID ||
    (attempt.status !== "created" && attempt.status !== "running")
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
      problem: "No active execute-1 attempt belongs to this task revision",
      impact: "No facts were written",
      remediation:
        "Claim an attempt first with: tc run <task-id> --node execute-1",
      context: { taskId, attemptId: expectedAttemptId ?? null },
    });
  }

  return attempt;
}

/** The record node has no independent run: a record segment in the execute
 * result is materialized as a finished record attempt plus evidence owned by
 * that attempt, so the obligation_results evidence-owner trigger and the
 * "evidence of the target attempt" invariant both hold. */
function writeRecordResult(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  record: { summary: string },
  actor: string,
  now: string,
): void {
  const recordAttemptId = attemptId(taskId, L1_RECORD_NODE_ID, 1);
  insertAttempt(database, {
    id: recordAttemptId,
    taskId,
    lifecycleRevision: snapshot.currentLifecycleRevision,
    nodeId: L1_RECORD_NODE_ID,
    attemptNumber: 1,
    actorInstanceId: actor,
    host: L1_DEFAULT_ACTOR,
    status: "finished",
    outcome: "success",
    resultJson: JSON.stringify(record),
    startedAt: now,
    finishedAt: now,
  });

  const evidenceId = `ev-${taskId}-${recordAttemptId}-1`;
  database
    .prepare(
      `INSERT INTO evidence (
         id, task_id, node_attempt_id, type, reference, summary, digest,
         created_by, created_at
       ) VALUES (?, ?, ?, 'note', ?, ?, NULL, ?, ?)`,
    )
    .run(
      evidenceId,
      taskId,
      recordAttemptId,
      `record://${taskId}`,
      record.summary,
      actor,
      now,
    );

  satisfyObligation(
    database,
    taskId,
    snapshot,
    L1_RECORD_NODE_ID,
    L1_OBLIGATION_IDS.resultAndScopeRetained,
    evidenceId,
    now,
  );
}
