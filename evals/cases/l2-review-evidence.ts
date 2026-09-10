import type { CaseJudgeEvidence, TaskSnapshot } from "../core/types.ts";
import type { L2ReviewTrace, ReviewObservation } from "./l2-review-flow.ts";

export interface L2ReviewStartEvidence {
  reviewAttemptId: string;
  reviewedAttemptId: string;
  purpose: string | null;
  capability: string | null;
  independenceStatus: string | null;
  response: Record<string, unknown>;
  reviewContext: Record<string, unknown> | null;
}

export interface L2ReviewAttemptEvidence {
  id: string | null;
  nodeId: string | null;
  status: string | null;
  outcome: string | null;
  attemptNumber: number | null;
  lifecycleRevision: number | null;
  reviewedAttemptId: string | null;
}

export interface L2ReviewJudgeEvidence extends CaseJudgeEvidence {
  kind: "l2-review";
  initialExecuteAttemptId: string;
  successorExecuteAttemptId: string | null;
  reviewAssociations: Array<{
    reviewAttemptId: string;
    reviewedAttemptId: string;
  }>;
  reviewStarts: {
    first: L2ReviewStartEvidence;
    second: L2ReviewStartEvidence | null;
  };
  stageReviewContexts: {
    first: Record<string, unknown> | null;
    second: Record<string, unknown> | null;
  };
  final: {
    taskId: string | null;
    status: string | null;
    attempts: L2ReviewAttemptEvidence[];
    findings: Array<Record<string, unknown>>;
    evidence: Array<Record<string, unknown>>;
  };
  fixtureProvenance: {
    factSubject: "fixture";
    source: "eval-controller";
    kind: "known-defect-sample";
  };
}

export function buildL2ReviewJudgeEvidence(
  trace: L2ReviewTrace,
): L2ReviewJudgeEvidence {
  const first = startEvidence(trace.firstReview);
  const second =
    trace.secondReview === null ? null : startEvidence(trace.secondReview);
  const finalSnapshot = finalSnapshotFor(trace);
  return {
    kind: "l2-review",
    initialExecuteAttemptId: trace.initialExecuteAttemptId,
    successorExecuteAttemptId: trace.successorExecuteAttemptId,
    reviewAssociations: [
      {
        reviewAttemptId: trace.firstReview.reviewAttemptId,
        reviewedAttemptId: trace.firstReview.reviewedAttemptId,
      },
      ...(trace.secondReview === null
        ? []
        : [
            {
              reviewAttemptId: trace.secondReview.reviewAttemptId,
              reviewedAttemptId: trace.secondReview.reviewedAttemptId,
            },
          ]),
    ],
    reviewStarts: { first, second },
    stageReviewContexts: {
      first: first.reviewContext,
      second: second?.reviewContext ?? null,
    },
    final: {
      taskId: finalSnapshot?.taskId ?? null,
      status: finalSnapshot?.status ?? null,
      attempts: (finalSnapshot?.attempts ?? []).map(attemptEvidence),
      findings: finalSnapshot?.findings ?? [],
      evidence: finalSnapshot?.evidence ?? [],
    },
    fixtureProvenance: {
      factSubject: "fixture",
      source: "eval-controller",
      kind: "known-defect-sample",
    },
  };
}

function startEvidence(review: ReviewObservation): L2ReviewStartEvidence {
  return {
    reviewAttemptId: review.reviewAttemptId,
    reviewedAttemptId: review.reviewedAttemptId,
    purpose: stringValue(review.data.purpose),
    capability: stringValue(review.data.capability),
    independenceStatus: stringValue(review.data.independenceStatus),
    response: review.data,
    reviewContext: reviewContext(review.task.snapshot),
  };
}

function finalSnapshotFor(trace: L2ReviewTrace): TaskSnapshot | null {
  return (
    trace.finalTask?.snapshot ??
    trace.afterSecondReview?.snapshot ??
    trace.repairTask?.snapshot ??
    trace.afterChanges.snapshot
  );
}

function attemptEvidence(
  attempt: Record<string, unknown>,
): L2ReviewAttemptEvidence {
  return {
    id: stringValue(attempt.id),
    nodeId: stringValue(attempt.nodeId),
    status: stringValue(attempt.status),
    outcome: stringValue(attempt.outcome),
    attemptNumber: numberValue(attempt.attemptNumber),
    lifecycleRevision: numberValue(attempt.lifecycleRevision),
    reviewedAttemptId: stringValue(attempt.reviewedAttemptId),
  };
}

function reviewContext(
  snapshot: TaskSnapshot | null,
): Record<string, unknown> | null {
  const context = snapshot?.nodeBrief?.reviewContext;
  return isRecord(context) ? context : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
