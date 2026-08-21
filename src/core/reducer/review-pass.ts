// reviewPass: closes the review with outcome=passed. The evidence gate
// requires at least one evidence row bound to the review attempt (a missing
// gate fails with TC_REQUIRED_EVIDENCE_MISSING and writes nothing). On
// success one transaction writes the evidence rows, the finished review
// attempt, the satisfied review-completed obligation, an optional advisory
// finding and the audit event; the next node becomes record-1.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getLifecycle } from "../../store/query.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import { isModularL3CompilerVersion } from "../lifecycle/l3.js";
import type { ReviewPassInput, ReviewResultData } from "./context.js";
import {
  assertNotCancelled,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import {
  bumpRevision,
  insertEvent,
  insertEvidence,
  nowIso,
  satisfyObligation,
} from "./shared.js";
import {
  insertFinding,
  nextFindingId,
  resolveActiveReview,
} from "./review-shared.js";
import { acceptL3Plan, type AcceptedL3Plan } from "./l3-accept-plan.js";

const REVIEW_EVIDENCE_TYPES = ["validation", "test", "artifact", "note"];

export function reviewPass(
  database: TaskcraftDatabase,
  taskId: string,
  input: ReviewPassInput,
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

    if (input.evidence.length === 0) {
      throw new TaskcraftError(ERROR_CODES.TC_REQUIRED_EVIDENCE_MISSING, {
        problem: "Review pass requires at least one evidence row",
        impact: "No facts were written; the review attempt stays open",
        remediation:
          "Record the review conclusion with the evidence parameter of: tc review pass <task-id>",
        context: { taskId, attemptId: attempt.id },
      });
    }

    for (const evidence of input.evidence) {
      if (!REVIEW_EVIDENCE_TYPES.includes(evidence.type)) {
        throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
          problem: `Review evidence type ${evidence.type} is not allowed`,
          impact: "No facts were written",
          remediation: "Use validation, test, artifact or note evidence types",
          context: { taskId, evidenceType: evidence.type },
        });
      }
    }

    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const now = nowIso();
    const evidenceIds = input.evidence.map((evidence, index) => {
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

    database
      .prepare(
        `UPDATE node_attempts SET status = 'finished', outcome = 'passed',
                result_json = ?, finished_at = ? WHERE id = ?`,
      )
      .run(
        JSON.stringify({ outcome: "passed", evidenceRefs: evidenceIds }),
        now,
        attempt.id,
      );
    // The review node's own required obligation (feasibility-completed /
    // delivery-completed / integration-review-completed / review-completed)
    // is resolved from the current graph so every review node passes alike.
    const reviewObligation = getLifecycle(
      database,
      taskId,
      snapshot.currentLifecycleRevision,
    ).obligations.find(
      (obligation) =>
        obligation.nodeId === attempt.nodeId && obligation.duty === "required",
    );
    satisfyObligation(
      database,
      taskId,
      snapshot,
      attempt.nodeId,
      reviewObligation!.id,
      evidenceIds[0]!,
      now,
    );

    let findingId: string | undefined;
    if (input.finding !== undefined && input.finding.trim() !== "") {
      findingId = nextFindingId(database, taskId);
      insertFinding(database, {
        id: findingId,
        taskId,
        reviewAttemptId: attempt.id,
        severity: "advisory",
        summary: input.finding,
        evidenceRefs: evidenceIds,
        now,
      });
    }

    insertEvent(database, {
      taskId,
      lifecycleRevision: snapshot.currentLifecycleRevision,
      nodeId: attempt.nodeId,
      attemptId: attempt.id,
      eventType: "review.passed",
      payload: { reviewedAttemptId: link.reviewedAttemptId, findingId },
      postTaskRevision: snapshot.revision + 1,
      actorInstanceId: actor,
      host: attempt.host,
      occurredAt: now,
    });
    let acceptedPlan: AcceptedL3Plan | undefined;
    const compiler = database
      .prepare(
        `SELECT compiler_version AS compilerVersion
         FROM lifecycle_revisions WHERE task_id = ? AND revision = ?`,
      )
      .get(taskId, snapshot.currentLifecycleRevision) as {
      compilerVersion: string;
    };
    if (
      snapshot.level === 3 &&
      link.reviewPurpose === "feasibility" &&
      isModularL3CompilerVersion(compiler.compilerVersion)
    ) {
      acceptedPlan = acceptL3Plan(
        database,
        snapshot,
        attempt,
        link.reviewedAttemptId,
        actor,
        now,
        input.acceptedPlanSpecBindings,
        compiler.compilerVersion,
      );
    }
    bumpRevision(database, snapshot, now);

    return {
      ...commandData(database, taskId, snapshotOf(database, taskId)),
      reviewAttemptId: attempt.id,
      reviewedAttemptId: link.reviewedAttemptId,
      ...(findingId === undefined ? {} : { findingId }),
      ...(acceptedPlan === undefined
        ? {}
        : {
            newRevision: acceptedPlan.newRevision,
            l3Mode: acceptedPlan.mode,
            materializedChildren: acceptedPlan.materializedChildren,
          }),
    };
  });
}
