// cancel: writes the cancellation facts, terminates active attempts of the
// current revision as cancelled/abandoned and appends the task.cancelled
// audit event. Re-cancelling a cancelled task is rejected.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getAttempts } from "../../store/query.js";
import { withTransaction } from "../../store/transaction.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import type { CancelInput, CommandData } from "./context.js";
import {
  assertNotCancelled,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import { bumpRevision, insertEvent, nowIso } from "./shared.js";

export function cancel(
  database: TaskcraftDatabase,
  taskId: string,
  input: CancelInput,
): CommandData {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);
    const now = nowIso();

    database
      .prepare(
        "UPDATE tasks SET cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?",
      )
      .run(now, input.reason, now, taskId);

    const activeAttempts = getAttempts(database, taskId).filter(
      (attempt) =>
        attempt.lifecycleRevision === snapshot.currentLifecycleRevision &&
        (attempt.status === "created" || attempt.status === "running"),
    );

    for (const attempt of activeAttempts) {
      database
        .prepare(
          `UPDATE node_attempts SET status = 'cancelled', outcome = 'abandoned',
                  finished_at = ? WHERE id = ?`,
        )
        .run(now, attempt.id);
    }

    insertEvent(database, {
      taskId,
      lifecycleRevision: snapshot.currentLifecycleRevision,
      nodeId: null,
      attemptId: null,
      eventType: "task.cancelled",
      payload: { reason: input.reason },
      postTaskRevision: snapshot.revision + 1,
      actorInstanceId: input.actorInstanceId ?? L1_DEFAULT_ACTOR,
      host: null,
      occurredAt: now,
    });
    bumpRevision(database, snapshot, now);

    return commandData(database, taskId, snapshotOf(database, taskId));
  });
}
