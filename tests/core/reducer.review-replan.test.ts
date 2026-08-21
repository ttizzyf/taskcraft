import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { reviewReplan, reviewStart } from "../../src/core/reducer.js";
import {
  getAttempts,
  getLastEventSeq,
  getLifecycle,
  getReviewFindings,
  getTask,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import {
  countEvents,
  queryEvents,
  reviewStartInput,
  setupL2ToReview,
} from "./reducer-utils.js";

describe("reducer reviewReplan", () => {
  it("atomically switches the lifecycle revision and supersedes the open attempts", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      const reviewAttemptId = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, executeAttemptId),
      }).reviewAttemptId;

      const result = reviewReplan(database, taskId, {
        taskId,
        attemptId: reviewAttemptId,
        reviewedAttemptId: executeAttemptId,
        reasonCode: "contract_changed",
        finding: "Retry policy must cover adapters outside core",
      });

      expect(result.newRevision).toBe(2);
      expect(result.status).toBe("active");
      expect(result.next).toBe(`tc run ${taskId} --node frame-1`);

      const task = getTask(database, taskId)!;
      expect(task.currentLifecycleRevision).toBe(2);
      expect(task.revision).toBe(7);

      const revisionRow = database
        .prepare(
          `SELECT reason_code AS reasonCode, reason, compiler_version AS compilerVersion,
                  change_summary_json AS changeSummary
           FROM lifecycle_revisions WHERE task_id = ? AND revision = 2`,
        )
        .get(taskId) as {
        reasonCode: string;
        reason: string;
        compilerVersion: string;
        changeSummary: string;
      };
      expect(revisionRow.reasonCode).toBe("contract_changed");
      expect(revisionRow.reason).toBe(
        "Retry policy must cover adapters outside core",
      );
      expect(revisionRow.compilerVersion).toBe("tc-l2/2");
      expect(JSON.parse(revisionRow.changeSummary)).toMatchObject({
        oldRevision: 1,
        newRevision: 2,
        reasonCode: "contract_changed",
      });

      const graph = getLifecycle(database, taskId, 2);
      expect(graph.nodes.map((node) => [node.id, node.kind])).toEqual([
        ["frame-1", "frame"],
        ["execute-1", "execute"],
        ["review-1", "review"],
        ["record-1", "record"],
      ]);
      expect(
        graph.edges.map((edge) => [edge.fromNodeId, edge.toNodeId]),
      ).toEqual([
        ["execute-1", "review-1"],
        ["frame-1", "execute-1"],
        ["review-1", "record-1"],
      ]);
      expect(graph.obligations.map((obligation) => obligation.id)).toEqual([
        "minimum-validation-recorded",
        "requested-outcome-produced",
        "frame-completed",
        "result-and-scope-retained",
        "review-completed",
      ]);

      const attempts = getAttempts(database, taskId);
      expect(attempts).toContainEqual(
        expect.objectContaining({
          id: reviewAttemptId,
          lifecycleRevision: 1,
          status: "superseded",
          outcome: "superseded",
        }),
      );
      // Finished facts keep their historical outcome.
      expect(attempts).toContainEqual(
        expect.objectContaining({
          id: executeAttemptId,
          lifecycleRevision: 1,
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
        }),
      ]);

      const events = queryEvents(database, taskId);
      expect(events.map((event) => event.eventType)).toEqual([
        "task.created",
        "task.activated",
        "attempt.finished",
        "attempt.created",
        "attempt.finished",
        "review.started",
        "review.replan_required",
      ]);
      expect(events.map((event) => event.taskSeq)).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
      expect(getLastEventSeq(database, taskId)).toBe(7);
    } finally {
      database.close();
    }
  });

  it("rejects an unknown reason code with zero partial facts", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      const reviewAttemptId = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, executeAttemptId),
      }).reviewAttemptId;
      const eventsBefore = countEvents(database);
      const revisionBefore = getTask(database, taskId)!.revision;

      const error = captureTaskcraftError(() =>
        reviewReplan(database, taskId, {
          taskId,
          attemptId: reviewAttemptId,
          reviewedAttemptId: executeAttemptId,
          reasonCode: "nonsense" as "replan_required",
          finding: "Nope",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_INPUT_INVALID);
      expect(getTask(database, taskId)!.currentLifecycleRevision).toBe(1);
      expect(getTask(database, taskId)!.revision).toBe(revisionBefore);
      expect(getReviewFindings(database, taskId)).toHaveLength(0);
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM lifecycle_revisions WHERE task_id = ? AND revision = 2",
          )
          .get(taskId) as { count: number },
      ).toEqual({ count: 0 });
      expect(countEvents(database)).toBe(eventsBefore);
      // The open review attempt survives the rejected replan.
      expect(getAttempts(database, taskId)).toContainEqual(
        expect.objectContaining({
          id: reviewAttemptId,
          status: "created",
        }),
      );
    } finally {
      database.close();
    }
  });

  it("rejects an empty finding with zero writes", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      const reviewAttemptId = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, executeAttemptId),
      }).reviewAttemptId;

      const error = captureTaskcraftError(() =>
        reviewReplan(database, taskId, {
          taskId,
          attemptId: reviewAttemptId,
          reviewedAttemptId: executeAttemptId,
          reasonCode: "scope_changed",
          finding: "",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_INPUT_INVALID);
      expect(getTask(database, taskId)!.currentLifecycleRevision).toBe(1);
      expect(getReviewFindings(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects replanning an already finished review attempt", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      const reviewAttemptId = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, executeAttemptId),
      }).reviewAttemptId;
      reviewReplan(database, taskId, {
        taskId,
        attemptId: reviewAttemptId,
        reviewedAttemptId: executeAttemptId,
        reasonCode: "manual_revision",
        finding: "Manual replan",
      });

      // After the revision switch the old review attempt is no longer part
      // of the current revision, so the reference check wins over the
      // already-passed check.
      const error = captureTaskcraftError(() =>
        reviewReplan(database, taskId, {
          taskId,
          attemptId: reviewAttemptId,
          reviewedAttemptId: executeAttemptId,
          reasonCode: "manual_revision",
          finding: "Again",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVIEW_REF_INVALID);
      expect(getTask(database, taskId)!.currentLifecycleRevision).toBe(2);
      expect(getLastEventSeq(database, taskId)).toBe(7);
    } finally {
      database.close();
    }
  });

  it("rejects a stale expected revision with TC_REVISION_CONFLICT", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      const reviewAttemptId = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, executeAttemptId),
      }).reviewAttemptId;

      const error = captureTaskcraftError(() =>
        reviewReplan(database, taskId, {
          taskId,
          attemptId: reviewAttemptId,
          reviewedAttemptId: executeAttemptId,
          reasonCode: "replan_required",
          finding: "Replan",
          expectedRevision: 1,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVISION_CONFLICT);
      expect(getTask(database, taskId)!.currentLifecycleRevision).toBe(1);
    } finally {
      database.close();
    }
  });
});
