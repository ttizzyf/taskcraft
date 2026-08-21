// reviewReplan: the review found that the scope, contract or lifecycle graph
// itself changed. One atomic transaction writes a blocking finding, a new
// lifecycle revision (typed reason, reason, old/new diff, digests) with the
// same L2 graph shape, switches tasks.current_lifecycle_revision, supersedes
// every created/running attempt of the old revision and appends the audit
// event. Historical attempts/evidence/findings stay queryable.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getTaskRelations } from "../../store/query.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import type { ReviewReplanInput, ReviewResultData } from "./context.js";
import {
  assertNotCancelled,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import { materializePlanningRevision } from "./revision-materialize.js";
import { recordReplacedChildren } from "./l3-replan.js";
import { bumpRevision, insertEvent, nowIso } from "./shared.js";
import {
  insertFinding,
  nextFindingId,
  resolveActiveReview,
  supersedeRevisionAttempts,
} from "./review-shared.js";

const REPLAN_REASON_CODES = [
  "replan_required",
  "scope_changed",
  "contract_changed",
  "level_changed",
  "manual_revision",
];

export function reviewReplan(
  database: TaskcraftDatabase,
  taskId: string,
  input: ReviewReplanInput,
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

    if (!REPLAN_REASON_CODES.includes(input.reasonCode)) {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
        problem: `Replan reason code ${input.reasonCode} is not a lifecycle revision reason`,
        impact: "No facts were written",
        remediation:
          "Use replan_required, scope_changed, contract_changed, level_changed or manual_revision",
        context: { taskId, reasonCode: input.reasonCode },
      });
    }

    if (input.finding.trim() === "") {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
        problem: "Review replan requires a non-empty finding",
        impact: "No facts were written",
        remediation:
          "Describe the contract change with: tc review replan <task-id> --finding <text>",
        context: { taskId, attemptId: attempt.id },
      });
    }

    const oldRevision = snapshot.currentLifecycleRevision;
    const newRevision = oldRevision + 1;
    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const now = nowIso();
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

    if (snapshot.parentTaskId !== null) {
      return replanParentFromChildReview(database, {
        child: snapshot,
        attempt,
        reviewedAttemptId: link.reviewedAttemptId,
        reasonCode: input.reasonCode,
        finding: input.finding,
        findingId,
        actor,
        now,
      });
    }

    // A replan rebuilds the graph of the task's own level: an L3 replan
    // re-compiles the L3 graph, so the new Plan goes through the Feasibility
    // Review again (lifecycle spec 9.1/9.2).
    materializePlanningRevision(database, {
      snapshot,
      newRevision,
      reasonCode: input.reasonCode,
      reason: input.finding,
      changeSummary: {
        oldRevision,
        newRevision,
        reasonCode: input.reasonCode,
        reviewedAttemptId: link.reviewedAttemptId,
      },
      actor,
      now,
    });
    if (snapshot.level === 3) {
      recordReplacedChildren(
        database,
        taskId,
        oldRevision,
        newRevision,
        snapshot.revision + 1,
        actor,
        now,
      );
    }

    database
      .prepare(
        "UPDATE tasks SET current_lifecycle_revision = ?, updated_at = ? WHERE id = ?",
      )
      .run(newRevision, now, taskId);

    supersedeRevisionAttempts(database, taskId, oldRevision, now);

    insertEvent(database, {
      taskId,
      // The event audits the review attempt, which belongs to the old
      // revision; the events FK matches attempt and revision exactly.
      lifecycleRevision: attempt.lifecycleRevision,
      nodeId: attempt.nodeId,
      attemptId: attempt.id,
      eventType: "review.replan_required",
      payload: {
        reasonCode: input.reasonCode,
        oldRevision,
        newRevision,
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
      newRevision,
    };
  });
}

interface ChildReviewReplanContext {
  child: TaskSnapshot;
  attempt: {
    id: string;
    lifecycleRevision: number;
    nodeId: string;
    host: string;
  };
  reviewedAttemptId: string;
  reasonCode: ReviewReplanInput["reasonCode"];
  finding: string;
  findingId: string;
  actor: string;
  now: string;
}

function replanParentFromChildReview(
  database: TaskcraftDatabase,
  context: ChildReviewReplanContext,
): ReviewResultData {
  const parent = resolveSnapshot(
    database,
    context.child.parentTaskId!,
    undefined,
  );
  assertNotCancelled(parent);
  const oldRevision = parent.currentLifecycleRevision;
  const relations = getTaskRelations(database, parent.id, oldRevision);
  const isCurrentRequiredChild = relations.children.some(
    (child) =>
      child.childTaskId === context.child.id &&
      child.requirementStatus === "required",
  );

  if (
    parent.level !== 3 ||
    relations.executionSource?.mode !== "modules" ||
    !isCurrentRequiredChild
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
      problem: `Child review ${context.attempt.id} is not part of the current modular L3 contract`,
      impact: "No parent revision or child review facts were written",
      remediation: `Inspect the current parent contract with: tc task show ${parent.id} --json`,
      context: { taskId: context.child.id, parentTaskId: parent.id },
    });
  }

  const newRevision = oldRevision + 1;
  materializePlanningRevision(database, {
    snapshot: parent,
    newRevision,
    reasonCode: context.reasonCode,
    reason: context.finding,
    changeSummary: {
      oldRevision,
      newRevision,
      reasonCode: context.reasonCode,
      sourceChildTaskId: context.child.id,
      reviewedAttemptId: context.reviewedAttemptId,
    },
    actor: context.actor,
    now: context.now,
  });
  recordReplacedChildren(
    database,
    parent.id,
    oldRevision,
    newRevision,
    parent.revision + 1,
    context.actor,
    context.now,
  );
  database
    .prepare(
      "UPDATE tasks SET current_lifecycle_revision = ?, updated_at = ? WHERE id = ?",
    )
    .run(newRevision, context.now, parent.id);

  // The parent stops requiring every old child, but Taskcraft does not
  // cancel or complete them. Only the review attempt that requested the
  // replan is closed as superseded; sibling runtime facts stay untouched.
  supersedeRevisionAttempts(
    database,
    context.child.id,
    context.child.currentLifecycleRevision,
    context.now,
  );
  supersedeRevisionAttempts(database, parent.id, oldRevision, context.now);

  insertEvent(database, {
    taskId: context.child.id,
    lifecycleRevision: context.attempt.lifecycleRevision,
    nodeId: context.attempt.nodeId,
    attemptId: context.attempt.id,
    eventType: "review.replan_required",
    payload: {
      reasonCode: context.reasonCode,
      parentTaskId: parent.id,
      parentOldRevision: oldRevision,
      parentNewRevision: newRevision,
      findingId: context.findingId,
    },
    postTaskRevision: context.child.revision + 1,
    actorInstanceId: context.actor,
    host: context.attempt.host,
    occurredAt: context.now,
  });
  insertEvent(database, {
    taskId: parent.id,
    lifecycleRevision: newRevision,
    nodeId: null,
    attemptId: null,
    eventType: "l3.replan_from_child",
    payload: {
      sourceChildTaskId: context.child.id,
      sourceReviewAttemptId: context.attempt.id,
      oldRevision,
      newRevision,
    },
    postTaskRevision: parent.revision + 1,
    actorInstanceId: context.actor,
    host: context.attempt.host,
    occurredAt: context.now,
  });
  bumpRevision(database, context.child, context.now);
  bumpRevision(database, parent, context.now);

  return {
    ...commandData(database, parent.id, snapshotOf(database, parent.id)),
    reviewAttemptId: context.attempt.id,
    reviewedAttemptId: context.reviewedAttemptId,
    findingId: context.findingId,
    newRevision,
  };
}
