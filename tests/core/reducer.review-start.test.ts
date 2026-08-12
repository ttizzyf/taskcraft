import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import {
  run,
  runComplete,
  reviewStart,
  taskNew,
} from "../../src/core/reducer.js";
import {
  getAttempts,
  getLastEventSeq,
  getReviewLinks,
  getTask,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import {
  countAttempts,
  L2_FRAME_RESULT,
  queryEvents,
  reviewStartInput,
  setupL2ToReview,
} from "./reducer-utils.js";

describe("reducer reviewStart", () => {
  it("writes the review attempt, the review link and the audit event in one transaction", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);

      const result = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, executeAttemptId),
      });

      expect(result.status).toBe("active");
      expect(result.reviewAttemptId).toBe(`att-${taskId}-review-1-1`);
      expect(result.reviewedAttemptId).toBe(executeAttemptId);
      expect(result.next).toBe(
        `tc review pass ${taskId} --attempt att-${taskId}-review-1-1 --reviewed-attempt ${executeAttemptId}`,
      );

      expect(getAttempts(database, taskId)).toContainEqual(
        expect.objectContaining({
          id: `att-${taskId}-review-1-1`,
          nodeId: "review-1",
          attemptNumber: 1,
          status: "created",
          outcome: null,
        }),
      );
      expect(getReviewLinks(database, taskId)).toEqual([
        expect.objectContaining({
          reviewAttemptId: `att-${taskId}-review-1-1`,
          reviewedAttemptId: executeAttemptId,
          reviewPurpose: "delivery",
          capability: "context-only",
          independenceStatus: "same-actor",
          reviewerPrincipalId: "cli",
          observedHostSessionId: null,
        }),
      ]);
      expect(
        queryEvents(database, taskId).map((event) => event.eventType),
      ).toEqual([
        "task.created",
        "task.activated",
        "attempt.finished",
        "attempt.created",
        "attempt.finished",
        "review.started",
      ]);
      expect(getLastEventSeq(database, taskId)).toBe(6);
    } finally {
      database.close();
    }
  });

  it("accepts an observed-distinct disclosure backed by host-observed and a session id", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);

      const result = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, executeAttemptId),
        capability: "host-observed",
        independenceStatus: "observed-distinct",
        observedHostSessionId: "session-42",
        host: "codex",
      });

      expect(result.reviewAttemptId).toBe(`att-${taskId}-review-1-1`);
      expect(getReviewLinks(database, taskId)[0]).toMatchObject({
        capability: "host-observed",
        independenceStatus: "observed-distinct",
        observedHostSessionId: "session-42",
      });
      expect(getAttempts(database, taskId)).toContainEqual(
        expect.objectContaining({
          id: `att-${taskId}-review-1-1`,
          host: "codex",
        }),
      );
    } finally {
      database.close();
    }
  });

  it("rejects a reviewedAttemptId that is not an execute attempt of the current revision", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = setupL2ToReview(database);
      const attemptsBefore = countAttempts(database);

      const error = captureTaskcraftError(() =>
        reviewStart(database, taskId, {
          ...reviewStartInput(taskId, "att-unknown-execute-9"),
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVIEW_REF_INVALID);
      expect(countAttempts(database)).toBe(attemptsBefore);
      expect(getReviewLinks(database, taskId)).toHaveLength(0);
      expect(getTask(database, taskId)!.revision).toBe(5);
    } finally {
      database.close();
    }
  });

  it("rejects a purpose that does not match the reviewed attempt kind", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);

      const error = captureTaskcraftError(() =>
        reviewStart(database, taskId, {
          ...reviewStartInput(taskId, executeAttemptId),
          purpose: "feasibility",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVIEW_PURPOSE_MISMATCH);
      expect(getReviewLinks(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects observed-distinct without host-observed or a session id", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);

      for (const input of [
        { capability: "context-only", independenceStatus: "observed-distinct" },
        {
          capability: "host-observed",
          independenceStatus: "observed-distinct",
        },
        {
          capability: "host-observed",
          independenceStatus: "observed-distinct",
          observedHostSessionId: "  ",
        },
      ] as const) {
        const error = captureTaskcraftError(() =>
          reviewStart(database, taskId, {
            ...reviewStartInput(taskId, executeAttemptId),
            ...input,
          }),
        );

        expect(error.code).toBe(ERROR_CODES.TC_REVIEW_INDEPENDENCE_INVALID);
      }

      expect(getReviewLinks(database, taskId)).toHaveLength(0);
      expect(countAttempts(database)).toBe(2);
    } finally {
      database.close();
    }
  });

  it("rejects starting a review when the review node is not runnable", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = setupL2ToReview(database);

      // execute is finished: start the first review, then a second start
      // must fail because a review attempt already exists (running node).
      const first = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, `att-${taskId}-execute-1-1`),
      });

      const error = captureTaskcraftError(() =>
        reviewStart(database, taskId, {
          ...reviewStartInput(taskId, first.reviewedAttemptId),
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(
        getAttempts(database, taskId).filter(
          (attempt) => attempt.nodeId === "review-1",
        ),
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("rejects claiming the review node with run: reviews open via review start only", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = setupL2ToReview(database);
      const attemptsBefore = countAttempts(database);

      const error = captureTaskcraftError(() =>
        run(database, taskId, { nodeId: "review-1" }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(countAttempts(database)).toBe(attemptsBefore);
      expect(getReviewLinks(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects starting a review before execute is satisfied", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "No execute yet",
        level: 2,
        reason: "reason",
      });
      run(database, taskId, { nodeId: "frame-1" });
      runComplete(database, taskId, {
        nodeId: "frame-1",
        result: L2_FRAME_RESULT,
      });
      run(database, taskId, { nodeId: "execute-1" });

      const error = captureTaskcraftError(() =>
        reviewStart(database, taskId, {
          ...reviewStartInput(taskId, `att-${taskId}-execute-1-1`),
        }),
      );

      // review-1 stays blocked while execute-1 is running.
      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(getReviewLinks(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects a stale expected revision with TC_REVISION_CONFLICT", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);

      const error = captureTaskcraftError(() =>
        reviewStart(database, taskId, {
          ...reviewStartInput(taskId, executeAttemptId),
          expectedRevision: 1,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVISION_CONFLICT);
      expect(getReviewLinks(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});
