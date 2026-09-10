import type { TaskcraftDatabase } from "../../store/database.js";
import { getAttempts } from "../../store/query.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import {
  L1_DEFAULT_ACTOR,
  L1_OBLIGATION_IDS,
  L1_RECORD_NODE_ID,
} from "../lifecycle/l1.js";
import type { CommandData, RunCompleteInput } from "./context.js";
import { commandData, snapshotOf } from "./context.js";
import { assertStoredNodeResult } from "./lifecycle-result.js";
import {
  insertAttemptFinishedEvent,
  resolveTargetAttempt,
} from "./run-complete-nodes.js";
import {
  attemptId,
  bumpRevision,
  finishAttempt,
  insertAttempt,
  insertEvidence,
  nowIso,
  satisfyObligation,
} from "./shared.js";
import { recordSpecImpact } from "./spec-impact.js";

export interface RecordResultShape {
  summary: string;
  changedScope?: Record<string, unknown>;
  residualRisks?: string[];
  specImpact?: unknown;
}

export function completeRecordNode(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  input: RunCompleteInput,
): CommandData {
  const result = input.result as RecordResultShape;
  assertStoredNodeResult(
    database,
    taskId,
    snapshot.currentLifecycleRevision,
    L1_RECORD_NODE_ID,
    result,
  );

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
  recordSpecImpact(
    database,
    taskId,
    snapshot,
    attempt.id,
    evidenceId,
    result.specImpact,
    input.resolvedSpecImpact,
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

/** Materializes an inline Record as a real successful attempt so its evidence
 * and Spec Impact share the same ownership and transaction. */
export function writeRecordResult(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  record: RecordResultShape,
  resolvedSpecImpact: RunCompleteInput["resolvedSpecImpact"],
  actor: string,
  now: string,
): void {
  const recordNumber =
    getAttempts(database, taskId)
      .filter((attempt) => attempt.nodeId === L1_RECORD_NODE_ID)
      .reduce((max, attempt) => Math.max(max, attempt.attemptNumber), 0) + 1;
  const recordAttemptId = attemptId(taskId, L1_RECORD_NODE_ID, recordNumber);
  insertAttempt(database, {
    id: recordAttemptId,
    taskId,
    lifecycleRevision: snapshot.currentLifecycleRevision,
    nodeId: L1_RECORD_NODE_ID,
    attemptNumber: recordNumber,
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
  recordSpecImpact(
    database,
    taskId,
    snapshot,
    recordAttemptId,
    evidenceId,
    record.specImpact,
    resolvedSpecImpact,
    actor,
    now,
  );
}
