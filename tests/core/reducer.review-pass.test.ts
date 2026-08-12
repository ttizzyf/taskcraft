import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { reviewPass, reviewStart } from "../../src/core/reducer.js";
import {
  getAttempts,
  getEvidence,
  getLastEventSeq,
  getObligationResults,
  getReviewFindings,
  getTask,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import {
  countAttempts,
  countEvents,
  queryEvents,
  reviewStartInput,
  setupL2ToReview,
} from "./reducer-utils.js";

function startReview(database: ReturnType<typeof createMigratedDatabase>): {
  taskId: string;
  executeAttemptId: string;
  reviewAttemptId: string;
} {
  const { taskId, executeAttemptId } = setupL2ToReview(database);
  const result = reviewStart(database, taskId, {
    ...reviewStartInput(taskId, executeAttemptId),
  });

  return { taskId, executeAttemptId, reviewAttemptId: result.reviewAttemptId };
}

const REVIEW_EVIDENCE = [
  {
    type: "validation" as const,
    reference: "ref://review-diff",
    summary: "Reviewer verified the diff and ran the boundary test",
  },
];

describe("reducer reviewPass", () => {
  it("atomically closes the review with passed and satisfies the review obligation", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId, reviewAttemptId } =
        startReview(database);

      const result = reviewPass(database, taskId, {
        taskId,
        attemptId: reviewAttemptId,
        reviewedAttemptId: executeAttemptId,
        evidence: REVIEW_EVIDENCE,
      });

      expect(result.status).toBe("active");
      expect(result.next).toBe(`tc run ${taskId} --node record-1`);
      expect(result.findingId).toBeUndefined();

      expect(getAttempts(database, taskId)).toContainEqual(
        expect.objectContaining({
          id: reviewAttemptId,
          status: "finished",
          outcome: "passed",
        }),
      );
      expect(getEvidence(database, taskId)).toContainEqual(
        expect.objectContaining({
          id: `ev-${taskId}-${reviewAttemptId}-1`,
          nodeAttemptId: reviewAttemptId,
          type: "validation",
        }),
      );
      expect(getObligationResults(database, taskId)).toContainEqual(
        expect.objectContaining({
          nodeId: "review-1",
          obligationId: "review-completed",
          status: "satisfied",
          satisfiedByEvidenceId: `ev-${taskId}-${reviewAttemptId}-1`,
        }),
      );
      expect(getReviewFindings(database, taskId)).toHaveLength(0);
      expect(
        queryEvents(database, taskId).map((event) => event.eventType),
      ).toEqual([
        "task.created",
        "task.activated",
        "attempt.finished",
        "attempt.created",
        "attempt.finished",
        "review.started",
        "review.passed",
      ]);
    } finally {
      database.close();
    }
  });

  it("writes an advisory finding when a finding is provided", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId, reviewAttemptId } =
        startReview(database);

      const result = reviewPass(database, taskId, {
        taskId,
        attemptId: reviewAttemptId,
        reviewedAttemptId: executeAttemptId,
        evidence: REVIEW_EVIDENCE,
        finding: "Consider documenting the retry backoff defaults",
      });

      expect(result.findingId).toBe(`fnd-${taskId}-1`);
      expect(getReviewFindings(database, taskId)).toEqual([
        expect.objectContaining({
          id: `fnd-${taskId}-1`,
          reviewAttemptId,
          severity: "advisory",
          disposition: "open",
          summary: "Consider documenting the retry backoff defaults",
        }),
      ]);
    } finally {
      database.close();
    }
  });

  it("fails with TC_REQUIRED_EVIDENCE_MISSING and writes nothing on an empty evidence gate", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId, reviewAttemptId } =
        startReview(database);
      const attemptsBefore = countAttempts(database);
      const eventsBefore = countEvents(database);
      const revisionBefore = getTask(database, taskId)!.revision;

      const error = captureTaskcraftError(() =>
        reviewPass(database, taskId, {
          taskId,
          attemptId: reviewAttemptId,
          reviewedAttemptId: executeAttemptId,
          evidence: [],
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REQUIRED_EVIDENCE_MISSING);
      expect(getAttempts(database, taskId)).toContainEqual(
        expect.objectContaining({
          id: reviewAttemptId,
          status: "created",
          outcome: null,
        }),
      );
      expect(countAttempts(database)).toBe(attemptsBefore);
      expect(countEvents(database)).toBe(eventsBefore);
      expect(getTask(database, taskId)!.revision).toBe(revisionBefore);
      expect(getEvidence(database, taskId)).toHaveLength(3);
      expect(getObligationResults(database, taskId)).toHaveLength(3);
      expect(getReviewFindings(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects passing an already finished review attempt", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId, reviewAttemptId } =
        startReview(database);
      reviewPass(database, taskId, {
        taskId,
        attemptId: reviewAttemptId,
        reviewedAttemptId: executeAttemptId,
        evidence: REVIEW_EVIDENCE,
      });

      const error = captureTaskcraftError(() =>
        reviewPass(database, taskId, {
          taskId,
          attemptId: reviewAttemptId,
          reviewedAttemptId: executeAttemptId,
          evidence: REVIEW_EVIDENCE,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVIEW_ALREADY_PASSED);
      expect(getLastEventSeq(database, taskId)).toBe(7);
    } finally {
      database.close();
    }
  });

  it("rejects a reviewedAttemptId that does not match the review link", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, reviewAttemptId } = startReview(database);

      const error = captureTaskcraftError(() =>
        reviewPass(database, taskId, {
          taskId,
          attemptId: reviewAttemptId,
          reviewedAttemptId: `att-${taskId}-execute-1-9`,
          evidence: REVIEW_EVIDENCE,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVIEW_REF_INVALID);
      expect(getReviewFindings(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects a stale expected revision with TC_REVISION_CONFLICT", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId, reviewAttemptId } =
        startReview(database);

      const error = captureTaskcraftError(() =>
        reviewPass(database, taskId, {
          taskId,
          attemptId: reviewAttemptId,
          reviewedAttemptId: executeAttemptId,
          evidence: REVIEW_EVIDENCE,
          expectedRevision: 1,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVISION_CONFLICT);
      expect(getLastEventSeq(database, taskId)).toBe(6);
    } finally {
      database.close();
    }
  });
});
