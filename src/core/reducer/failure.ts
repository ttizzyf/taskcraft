// Failure attempt semantics (no CLI in this task): marks an attempt failed
// and, when the retry budget of the node is exhausted (L1 default: 3
// consecutive failures), writes an open failed_retries_exhausted blocker so
// the projector derives waiting.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getAttempts } from "../../store/query.js";
import { withTransaction } from "../../store/transaction.js";
import {
  L1_DEFAULT_ACTOR,
  L1_EXECUTE_NODE_ID,
  L1_RETRY_POLICY,
} from "../lifecycle/l1.js";
import type { AttemptFailureInput, CommandData } from "./context.js";
import {
  attemptRefError,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import { bumpRevision, insertEvent, nowIso } from "./shared.js";

export function recordAttemptFailure(
  database: TaskcraftDatabase,
  taskId: string,
  input: AttemptFailureInput,
): CommandData {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    const attempt = getAttempts(database, taskId).find(
      (candidate) => candidate.id === input.attemptId,
    );

    if (
      attempt === undefined ||
      attempt.taskId !== taskId ||
      attempt.lifecycleRevision !== snapshot.currentLifecycleRevision ||
      attempt.nodeId !== L1_EXECUTE_NODE_ID ||
      (attempt.status !== "created" && attempt.status !== "running")
    ) {
      throw attemptRefError(
        taskId,
        `Attempt ${input.attemptId} is not an active execute-1 attempt of this revision`,
        "Claim an attempt first with: tc run <task-id> --node execute-1",
      );
    }

    const now = nowIso();
    database
      .prepare(
        `UPDATE node_attempts SET status = 'failed', outcome = 'failed',
                finished_at = ? WHERE id = ?`,
      )
      .run(now, attempt.id);

    const failedCount = getAttempts(database, taskId).filter(
      (candidate) =>
        candidate.lifecycleRevision === snapshot.currentLifecycleRevision &&
        candidate.nodeId === L1_EXECUTE_NODE_ID &&
        candidate.outcome === "failed",
    ).length;

    if (failedCount >= L1_RETRY_POLICY.maxRetries) {
      writeRetryExhaustionBlocker(
        database,
        taskId,
        snapshot,
        input.reason,
        now,
      );
    }

    insertEvent(database, {
      taskId,
      lifecycleRevision: snapshot.currentLifecycleRevision,
      nodeId: attempt.nodeId,
      attemptId: attempt.id,
      eventType: "attempt.failed",
      payload: { reason: input.reason },
      postTaskRevision: snapshot.revision + 1,
      actorInstanceId: input.actorInstanceId ?? L1_DEFAULT_ACTOR,
      host: attempt.host,
      occurredAt: now,
    });
    bumpRevision(database, snapshot, now);

    return commandData(database, taskId, snapshotOf(database, taskId));
  });
}

function writeRetryExhaustionBlocker(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: { currentLifecycleRevision: number },
  reason: string,
  now: string,
): void {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM blockers WHERE task_id = ?")
    .get(taskId) as { count: number };

  database
    .prepare(
      `INSERT INTO blockers (
         id, task_id, lifecycle_revision, node_id, kind, waiting_reason,
         status, reason, remediation_command, created_at, resolved_at
       ) VALUES (?, ?, ?, ?, 'evidence', 'failed_retries_exhausted',
         'open', ?, ?, ?, NULL)`,
    )
    .run(
      `blk-${taskId}-${row.count + 1}`,
      taskId,
      snapshot.currentLifecycleRevision,
      L1_EXECUTE_NODE_ID,
      reason,
      `tc run ${taskId} --node execute-1`,
      now,
    );
}
