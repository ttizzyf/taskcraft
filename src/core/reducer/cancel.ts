// cancel: writes the cancellation facts, terminates active attempts of the
// current revision as cancelled/abandoned and appends the task.cancelled
// audit event. Re-cancelling a cancelled task is rejected.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getAttempts, getTaskRelations } from "../../store/query.js";
import { withTransaction } from "../../store/transaction.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { project } from "../projector.js";
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
    assertRequiredChildrenResolved(
      database,
      snapshot.id,
      snapshot.currentLifecycleRevision,
    );
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

function assertRequiredChildrenResolved(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
): void {
  const unresolved = getTaskRelations(database, taskId, revision)
    .children.filter((child) => child.requirementStatus === "required")
    .filter((child) => {
      const status = project(database, child.childTaskId).status;
      return status === "queued" || status === "active" || status === "waiting";
    });

  if (unresolved.length === 0) return;
  const childIds = unresolved.map((child) => child.childTaskId).join(", ");
  throw new TaskcraftError(ERROR_CODES.TC_TASK_CHILDREN_UNRESOLVED, {
    problem: `Parent task ${taskId} still requires unfinished children: ${childIds}`,
    impact: "The parent was not cancelled and no child facts were changed",
    remediation:
      "Stop any host runs yourself, then complete or cancel each listed child, or accept a parent replan that marks it not required",
    context: { taskId, unresolvedChildCount: unresolved.length },
  });
}
