// runComplete: validates the submitted result against the target node's
// result schema (no facts are written on failure), binds the evidence to the
// target attempt, closes the attempt and satisfies its obligations.
//
// execute-1: the execute result can carry a `record` segment, which
// materializes the record attempt and satisfies the record obligation in the
// same transaction. record-1 (claimed after a record-less execute result)
// completes the record node standalone: a note evidence row is generated for
// the record obligation's evidence-owner trigger.

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
import type { CommandData, RunCompleteInput } from "./context.js";
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
  insertEvidence,
  nowIso,
  satisfyObligation,
  validateExecuteResult,
  validateRecordResult,
} from "./shared.js";

export function runComplete(
  database: TaskcraftDatabase,
  taskId: string,
  input: RunCompleteInput,
): CommandData {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);
    const nodeId = input.nodeId ?? L1_EXECUTE_NODE_ID;

    if (nodeId === L1_EXECUTE_NODE_ID) {
      return completeExecuteNode(database, taskId, snapshot, input);
    }

    if (nodeId === L1_RECORD_NODE_ID) {
      return completeRecordNode(database, taskId, snapshot, input);
    }

    throw new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
      problem: `Node ${nodeId} cannot be completed`,
      impact: "No facts were written",
      remediation:
        "Complete execute-1 or record-1 with: tc run complete <task-id> --node <node>",
      context: { taskId, nodeId },
    });
  });
}

function completeExecuteNode(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  input: RunCompleteInput,
): CommandData {
  const result = input.result as ExecuteResultShape;

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
    L1_EXECUTE_NODE_ID,
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
    insertEvidence(database, {
      id,
      taskId,
      attemptId: attempt.id,
      type: evidence.type,
      reference: evidence.reference,
      summary: evidence.summary,
      digest: evidence.digest ?? null,
      actor,
      now,
    });
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

  insertAttemptFinishedEvent(
    database,
    taskId,
    snapshot,
    attempt.id,
    attempt.nodeId,
    attempt.host,
    actor,
    now,
  );
  bumpRevision(database, snapshot, now);

  return commandData(database, taskId, snapshotOf(database, taskId));
}

/** Standalone record completion: validates against the record schema,
 * generates the note evidence, closes the record attempt and satisfies the
 * record obligation. */
function completeRecordNode(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  input: RunCompleteInput,
): CommandData {
  const result = input.result as { summary: string };

  if (!validateRecordResult(result)) {
    throw new TaskcraftError(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID, {
      problem: `Result for ${L1_RECORD_NODE_ID} failed the node result schema`,
      impact: "No facts were written; the task keeps its current state",
      remediation:
        "Resubmit a result matching the record-1 result schema from the Node Brief",
      context: { taskId },
    });
  }

  const attempt = resolveTargetAttempt(
    database,
    taskId,
    snapshot,
    input.attemptId,
    L1_RECORD_NODE_ID,
  );
  const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
  const now = nowIso();
  const evidenceId = `ev-${taskId}-${attempt.id}-1`;

  insertEvidence(database, {
    id: evidenceId,
    taskId,
    attemptId: attempt.id,
    type: "note",
    reference: `record://${taskId}`,
    summary: result.summary,
    digest: null,
    actor,
    now,
  });
  finishAttempt(database, attempt.id, result, now);
  satisfyObligation(
    database,
    taskId,
    snapshot,
    L1_RECORD_NODE_ID,
    L1_OBLIGATION_IDS.resultAndScopeRetained,
    evidenceId,
    now,
  );
  insertAttemptFinishedEvent(
    database,
    taskId,
    snapshot,
    attempt.id,
    attempt.nodeId,
    attempt.host,
    actor,
    now,
  );
  bumpRevision(database, snapshot, now);

  return commandData(database, taskId, snapshotOf(database, taskId));
}

function insertAttemptFinishedEvent(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  attemptIdToFinish: string,
  nodeId: string,
  host: string,
  actor: string,
  now: string,
): void {
  insertEvent(database, {
    taskId,
    lifecycleRevision: snapshot.currentLifecycleRevision,
    nodeId,
    attemptId: attemptIdToFinish,
    eventType: "attempt.finished",
    payload: { outcome: "success" },
    postTaskRevision: snapshot.revision + 1,
    actorInstanceId: actor,
    host,
    occurredAt: now,
  });
}

/** Picks the attempt to close: the caller's attemptId (validated against the
 * current revision and node) or the active attempt of the target node. */
function resolveTargetAttempt(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  expectedAttemptId: string | undefined,
  nodeId: string,
) {
  const attempts = getAttempts(database, taskId).filter(
    (attempt) =>
      attempt.lifecycleRevision === snapshot.currentLifecycleRevision,
  );
  const attempt = expectedAttemptId
    ? attempts.find((candidate) => candidate.id === expectedAttemptId)
    : attempts.find(
        (candidate) =>
          candidate.nodeId === nodeId &&
          (candidate.status === "created" || candidate.status === "running"),
      );

  if (
    attempt === undefined ||
    attempt.nodeId !== nodeId ||
    (attempt.status !== "created" && attempt.status !== "running")
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
      problem: `No active ${nodeId} attempt belongs to this task revision`,
      impact: "No facts were written",
      remediation: `Claim an attempt first with: tc run <task-id> --node ${nodeId}`,
      context: { taskId, attemptId: expectedAttemptId ?? null, nodeId },
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
  insertEvidence(database, {
    id: evidenceId,
    taskId,
    attemptId: recordAttemptId,
    type: "note",
    reference: `record://${taskId}`,
    summary: record.summary,
    digest: null,
    actor,
    now,
  });

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

/** The shape accepted by the execute-1 result schema (after Ajv passed). */
interface ExecuteResultShape {
  summary: string;
  evidence: Array<{
    type: "validation" | "test" | "artifact" | "note";
    reference: string;
    summary: string;
    digest?: string;
  }>;
  record?: { summary: string };
}
