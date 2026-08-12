import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { reviewChanges, reviewStart } from "../../src/core/reducer.js";
import {
  getAttempts,
  getLastEventSeq,
  getReviewFindings,
  getTask,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import {
  countAttempts,
  queryEvents,
  reviewStartInput,
  setupL2ToReview,
} from "./reducer-utils.js";

describe("reducer reviewChanges", () => {
  it("writes a blocking finding and a successor execute attempt without touching scope or contract", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      const reviewAttemptId = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, executeAttemptId),
      }).reviewAttemptId;

      const result = reviewChanges(database, taskId, {
        taskId,
        attemptId: reviewAttemptId,
        reviewedAttemptId: executeAttemptId,
        finding: "Missing boundary test for the retry policy",
      });

      expect(result.findingId).toBe(`fnd-${taskId}-1`);
      expect(result.successorAttemptId).toBe(`att-${taskId}-execute-1-2`);
      expect(result.next).toBe(`tc run complete ${taskId}`);

      const attempts = getAttempts(database, taskId);
      expect(attempts).toContainEqual(
        expect.objectContaining({
          id: reviewAttemptId,
          status: "finished",
          outcome: "changes_requested",
        }),
      );
      expect(attempts).toContainEqual(
        expect.objectContaining({
          id: `att-${taskId}-execute-1-2`,
          nodeId: "execute-1",
          attemptNumber: 2,
          status: "created",
        }),
      );
      // The reviewed execute attempt keeps its finished success outcome.
      expect(attempts).toContainEqual(
        expect.objectContaining({
          id: executeAttemptId,
          status: "finished",
          outcome: "success",
        }),
      );
      expect(getReviewFindings(database, taskId)).toEqual([
        expect.objectContaining({
          id: `fnd-${taskId}-1`,
          reviewAttemptId,
          severity: "blocking",
          disposition: "open",
          summary: "Missing boundary test for the retry policy",
        }),
      ]);
      // No new lifecycle revision: the current one is untouched.
      expect(getTask(database, taskId)!.currentLifecycleRevision).toBe(1);
      expect(
        queryEvents(database, taskId).map((event) => event.eventType),
      ).toEqual([
        "task.created",
        "task.activated",
        "attempt.finished",
        "attempt.created",
        "attempt.finished",
        "review.started",
        "review.changes_requested",
      ]);
    } finally {
      database.close();
    }
  });

  it("numbers the successor attempt after the reviewed node's current maximum", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      const first = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, executeAttemptId),
      });

      // First changes round creates execute-1-2 and closes review-1-1.
      reviewChanges(database, taskId, {
        taskId,
        attemptId: first.reviewAttemptId,
        reviewedAttemptId: executeAttemptId,
        finding: "Round one",
      });

      // Complete execute-1-2, start a second review of it, then request
      // changes again: the new successor is execute-1-3.
      const second = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, `att-${taskId}-execute-1-2`),
      });
      const result = reviewChanges(database, taskId, {
        taskId,
        attemptId: second.reviewAttemptId,
        reviewedAttemptId: `att-${taskId}-execute-1-2`,
        finding: "Round two",
      });

      expect(result.successorAttemptId).toBe(`att-${taskId}-execute-1-3`);
      expect(
        getAttempts(database, taskId)
          .filter((attempt) => attempt.nodeId === "execute-1")
          .map((attempt) => attempt.attemptNumber),
      ).toEqual([1, 2, 3]);
    } finally {
      database.close();
    }
  });

  it("rejects an empty finding with TC_TASK_INPUT_INVALID and zero writes", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      const reviewAttemptId = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, executeAttemptId),
      }).reviewAttemptId;
      const attemptsBefore = countAttempts(database);
      const revisionBefore = getTask(database, taskId)!.revision;

      const error = captureTaskcraftError(() =>
        reviewChanges(database, taskId, {
          taskId,
          attemptId: reviewAttemptId,
          reviewedAttemptId: executeAttemptId,
          finding: "   ",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_INPUT_INVALID);
      expect(countAttempts(database)).toBe(attemptsBefore);
      expect(getReviewFindings(database, taskId)).toHaveLength(0);
      expect(getTask(database, taskId)!.revision).toBe(revisionBefore);
    } finally {
      database.close();
    }
  });

  it("rejects changes on an already finished review attempt", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      const reviewAttemptId = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, executeAttemptId),
      }).reviewAttemptId;
      reviewChanges(database, taskId, {
        taskId,
        attemptId: reviewAttemptId,
        reviewedAttemptId: executeAttemptId,
        finding: "First round",
      });

      const error = captureTaskcraftError(() =>
        reviewChanges(database, taskId, {
          taskId,
          attemptId: reviewAttemptId,
          reviewedAttemptId: executeAttemptId,
          finding: "Second round",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVIEW_ALREADY_PASSED);
      expect(getLastEventSeq(database, taskId)).toBe(7);
      expect(getReviewFindings(database, taskId)).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
