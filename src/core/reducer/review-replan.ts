// reviewReplan: the review found that the scope, contract or lifecycle graph
// itself changed. One atomic transaction writes a blocking finding, a new
// lifecycle revision (typed reason, reason, old/new diff, digests) with the
// same L2 graph shape, switches tasks.current_lifecycle_revision, supersedes
// every created/running attempt of the old revision and appends the audit
// event. Historical attempts/evidence/findings stay queryable.

import type { TaskcraftDatabase } from "../../store/database.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import {
  L2_COMPILER_VERSION,
  L2_FACTS_DIGEST,
  L2_POLICY_DIGEST,
} from "../lifecycle/l2.js";
import {
  L3_COMPILER_VERSION,
  L3_FACTS_DIGEST,
  L3_POLICY_DIGEST,
} from "../lifecycle/l3.js";
import type { ReviewReplanInput, ReviewResultData } from "./context.js";
import {
  assertNotCancelled,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import { materializeL2Graph } from "./l2-materialize.js";
import { materializeL3Graph } from "./l3-materialize.js";
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

    // A replan rebuilds the graph of the task's own level: an L3 replan
    // re-compiles the L3 graph, so the new Plan goes through the Feasibility
    // Review again (lifecycle spec 9.1/9.2).
    const graphInput = {
      taskId,
      revision: newRevision,
      reasonCode: input.reasonCode,
      reason: input.finding,
      changeSummary: {
        oldRevision,
        newRevision,
        reasonCode: input.reasonCode,
        reviewedAttemptId: link.reviewedAttemptId,
      },
      objective: snapshot.objectiveMd,
      actor,
      now,
    };

    if (snapshot.level === 3) {
      materializeL3Graph(database, {
        ...graphInput,
        compilerVersion: L3_COMPILER_VERSION,
        factsDigest: L3_FACTS_DIGEST,
        policyDigest: L3_POLICY_DIGEST,
      });
    } else {
      materializeL2Graph(database, {
        ...graphInput,
        compilerVersion: L2_COMPILER_VERSION,
        factsDigest: L2_FACTS_DIGEST,
        policyDigest: L2_POLICY_DIGEST,
      });
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
