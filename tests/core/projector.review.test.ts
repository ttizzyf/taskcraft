import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import {
  reviewPass,
  reviewStart,
  run,
  runComplete,
  taskNew,
} from "../../src/core/reducer.js";
import { project } from "../../src/core/projector.js";
import {
  getAttempts,
  getReviewFindings,
  getReviewLinks,
} from "../../src/store/query.js";
import { loadFixtureFile } from "../helpers/load-fixture.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import {
  L2_EXECUTE_RESULT,
  L2_FRAME_RESULT,
  reviewStartInput,
} from "./reducer-utils.js";

describe("projector L2 graph", () => {
  it("materializes the L2 graph for task new --level 2 and projects queued", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "L2 card",
        level: 2,
        reason: "reason",
      });

      const projection = project(database, taskId);

      expect(projection.status).toBe("queued");
      expect(projection.next).toBe(`tc run ${taskId} --node frame-1`);
      expect(
        projection.nodeStatuses.map((node) => [
          node.nodeId,
          node.kind,
          node.status,
        ]),
      ).toEqual([
        ["frame-1", "frame", "runnable"],
        ["execute-1", "execute", "blocked"],
        ["review-1", "review", "blocked"],
        ["record-1", "record", "blocked"],
      ]);
      expect(projection.doneObligations).toBe(0);
      expect(projection.totalObligations).toBe(5);
    } finally {
      database.close();
    }
  });

  it("keeps the L1 graph for level 1 and rejects level 3", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "L1 card",
        level: 1,
        reason: "reason",
      });
      expect(project(database, taskId).next).toBe(`tc run ${taskId}`);
      expect(project(database, taskId).totalObligations).toBe(3);

      const error = captureTaskcraftError(() =>
        taskNew(database, { title: "L3", level: 3, reason: "reason" }),
      );
      expect(error.code).toBe(ERROR_CODES.TC_TASK_LEVEL_UNSUPPORTED);
    } finally {
      database.close();
    }
  });

  it("drives the full L2 loop through the reducer to done", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "Full L2 loop",
        level: 2,
        reason: "reason",
      });

      run(database, taskId, { nodeId: "frame-1" });
      runComplete(database, taskId, {
        nodeId: "frame-1",
        result: L2_FRAME_RESULT,
      });
      run(database, taskId, { nodeId: "execute-1" });
      runComplete(database, taskId, { result: L2_EXECUTE_RESULT });

      const executeAttemptId = `att-${taskId}-execute-1-1`;
      const review = reviewStart(database, taskId, {
        ...reviewStartInput(taskId, executeAttemptId),
      });
      reviewPass(database, taskId, {
        taskId,
        attemptId: review.reviewAttemptId,
        reviewedAttemptId: executeAttemptId,
        evidence: [
          {
            type: "validation" as const,
            reference: "ref://review",
            summary: "Reviewed",
          },
        ],
      });

      // record-1 becomes runnable only after the review passed.
      const afterReview = project(database, taskId);
      expect(afterReview.runnableNodes).toEqual(["record-1"]);
      expect(afterReview.next).toBe(`tc run ${taskId} --node record-1`);

      run(database, taskId, { nodeId: "record-1" });
      runComplete(database, taskId, {
        nodeId: "record-1",
        result: { summary: "Recorded" },
      });

      const projection = project(database, taskId);
      expect(projection.status).toBe("done");
      expect(projection.next).toBeNull();
      expect(projection.doneObligations).toBe(5);
      expect(projection.totalObligations).toBe(5);
      expect(
        projection.nodeStatuses.map((node) => [node.nodeId, node.status]),
      ).toEqual([
        ["frame-1", "satisfied"],
        ["execute-1", "satisfied"],
        ["review-1", "satisfied"],
        ["record-1", "satisfied"],
      ]);
    } finally {
      database.close();
    }
  });
});

describe("projector review fixtures", () => {
  it("projects the l2-pass fixture as done with all four nodes satisfied", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "l2-pass");

      const projection = project(database, "T-201");

      expect(projection.status).toBe("done");
      expect(projection.next).toBeNull();
      expect(projection.doneObligations).toBe(5);
      expect(projection.totalObligations).toBe(5);
      expect(
        projection.nodeStatuses.map((node) => [node.nodeId, node.status]),
      ).toEqual([
        ["frame-1", "satisfied"],
        ["execute-1", "satisfied"],
        ["review-1", "satisfied"],
        ["record-1", "satisfied"],
      ]);
      expect(getReviewLinks(database, "T-201")[0]).toMatchObject({
        reviewAttemptId: "att-T-201-review-1-1",
        reviewedAttemptId: "att-T-201-execute-1-1",
        reviewPurpose: "delivery",
      });
    } finally {
      database.close();
    }
  });

  it("projects review-changes-requested as active pointing at the successor execute", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "review-changes-requested");

      const projection = project(database, "T-202");

      expect(projection.status).toBe("active");
      expect(projection.runningNode).toBe("execute-1");
      expect(projection.next).toBe("tc run complete T-202");
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({ nodeId: "review-1", status: "runnable" }),
      );
      expect(getReviewFindings(database, "T-202")).toEqual([
        expect.objectContaining({
          severity: "blocking",
          disposition: "open",
        }),
      ]);
      expect(getAttempts(database, "T-202")).toContainEqual(
        expect.objectContaining({
          id: "att-T-202-execute-1-2",
          status: "created",
        }),
      );
    } finally {
      database.close();
    }
  });

  it("projects review-replan-required on the new revision without hiding history", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "review-replan-required");

      const projection = project(database, "T-203");

      expect(projection.status).toBe("active");
      expect(projection.next).toBe("tc run T-203 --node frame-1");
      expect(projection.runnableNodes).toEqual(["frame-1"]);
      expect(
        projection.nodeStatuses.map((node) => [node.nodeId, node.status]),
      ).toEqual([
        ["frame-1", "runnable"],
        ["execute-1", "blocked"],
        ["review-1", "blocked"],
        ["record-1", "blocked"],
      ]);

      // Historical facts stay queryable: the superseded review attempt and
      // the revision-1 graph are still there.
      expect(getAttempts(database, "T-203")).toContainEqual(
        expect.objectContaining({
          id: "att-T-203-review-1-1",
          lifecycleRevision: 1,
          status: "superseded",
          outcome: "superseded",
        }),
      );
      expect(getAttempts(database, "T-203")).toContainEqual(
        expect.objectContaining({
          id: "att-T-203-execute-1-1",
          lifecycleRevision: 1,
          status: "finished",
          outcome: "success",
        }),
      );
      expect(getReviewFindings(database, "T-203")).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("projects review-same-actor and review-unverified as review pass next", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "review-same-actor");
      loadFixtureFile(database, "review-unverified");

      expect(project(database, "T-204")).toMatchObject({
        status: "active",
        runningNode: "review-1",
        next: "tc review pass T-204 --attempt att-T-204-review-1-1 --reviewed-attempt att-T-204-execute-1-1",
      });
      expect(project(database, "T-205")).toMatchObject({
        status: "active",
        runningNode: "review-1",
        next: "tc review pass T-205 --attempt att-T-205-review-1-1 --reviewed-attempt att-T-205-execute-1-1",
      });
      expect(getReviewLinks(database, "T-204")[0]).toMatchObject({
        capability: "context-only",
        independenceStatus: "same-actor",
      });
      expect(getReviewLinks(database, "T-205")[0]).toMatchObject({
        capability: "manual-attach",
        independenceStatus: "unverified",
      });
      // record-1 stays blocked until the review passes.
      expect(project(database, "T-204").runnableNodes).toEqual([]);
      expect(project(database, "T-204").nodeStatuses).toContainEqual(
        expect.objectContaining({ nodeId: "record-1", status: "blocked" }),
      );
    } finally {
      database.close();
    }
  });

  it("imports the review-missing-evidence fixture and projects the review as running", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "review-missing-evidence");

      const projection = project(database, "T-206");

      expect(projection.status).toBe("active");
      expect(projection.next).toBe(
        "tc review pass T-206 --attempt att-T-206-review-1-1 --reviewed-attempt att-T-206-execute-1-1",
      );
    } finally {
      database.close();
    }
  });
});
