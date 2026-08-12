// reviewChanges: requests changes on the current revision. One transaction
// writes a blocking finding, closes the review attempt as
// changes_requested and creates a successor attempt for the reviewed node
// kind (execute, attempt_number = current max + 1). Scope and contract stay
// unchanged: no new revision is written and the reviewed execute attempt
// keeps its finished outcome.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getAttempts } from "../../store/query.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import type { ReviewChangesInput, ReviewResultData } from "./context.js";
import {
  assertNotCancelled,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import {
  attemptId,
  bumpRevision,
  insertAttempt,
  insertEvent,
  nowIso,
} from "./shared.js";
import {
  insertFinding,
  nextFindingId,
  resolveActiveReview,
} from "./review-shared.js";

export function reviewChanges(
  database: TaskcraftDatabase,
  taskId: string,
  input: ReviewChangesInput,
): ReviewResultData {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);
    const { attempt, link } = resolveActiveReview(
      database,
      taskId,
      snapshot,
      input.attemptId,
      input.reviewedAttemptId,
    );

    if (input.finding.trim() === "") {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
        problem: "Review changes requires a non-empty finding",
        impact: "No facts were written",
        remediation:
          "Describe what must change with: tc review changes <task-id> --finding <text>",
        context: { taskId, attemptId: attempt.id },
      });
    }

    const reviewedAttempt = getAttempts(database, taskId).find(
      (candidate) => candidate.id === link.reviewedAttemptId,
    );
    const reviewedNodeId = reviewedAttempt?.nodeId ?? "execute-1";
    const revision = snapshot.currentLifecycleRevision;
    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const now = nowIso();
    const successorNumber =
      getAttempts(database, taskId)
        .filter(
          (candidate) =>
            candidate.lifecycleRevision === revision &&
            candidate.nodeId === reviewedNodeId,
        )
        .reduce((max, candidate) => Math.max(max, candidate.attemptNumber), 0) +
      1;
    const successorAttempt = attemptId(taskId, reviewedNodeId, successorNumber);

    insertAttempt(database, {
      id: successorAttempt,
      taskId,
      lifecycleRevision: revision,
      nodeId: reviewedNodeId,
      attemptNumber: successorNumber,
      actorInstanceId: actor,
      host: L1_DEFAULT_ACTOR,
      status: "created",
      outcome: null,
      resultJson: null,
      startedAt: null,
      finishedAt: null,
    });

    const findingId = nextFindingId(database, taskId);
    insertFinding(database, {
      id: findingId,
      taskId,
      reviewAttemptId: attempt.id,
      severity: "blocking",
      summary: input.finding,
      evidenceRefs: [],
      now,
    });

    database
      .prepare(
        `UPDATE node_attempts SET status = 'finished', outcome = 'changes_requested',
                result_json = ?, finished_at = ? WHERE id = ?`,
      )
      .run(
        JSON.stringify({
          outcome: "changes_requested",
          successorAttemptId: successorAttempt,
          findingId,
        }),
        now,
        attempt.id,
      );
    insertEvent(database, {
      taskId,
      lifecycleRevision: revision,
      nodeId: attempt.nodeId,
      attemptId: attempt.id,
      eventType: "review.changes_requested",
      payload: {
        reviewedAttemptId: link.reviewedAttemptId,
        successorAttemptId: successorAttempt,
        findingId,
      },
      postTaskRevision: snapshot.revision + 1,
      actorInstanceId: actor,
      host: attempt.host,
      occurredAt: now,
    });
    bumpRevision(database, snapshot, now);

    return {
      ...commandData(database, taskId, snapshotOf(database, taskId)),
      reviewAttemptId: attempt.id,
      reviewedAttemptId: link.reviewedAttemptId,
      findingId,
      successorAttemptId: successorAttempt,
    };
  });
}
