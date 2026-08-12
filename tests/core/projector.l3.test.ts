import { describe, expect, it } from "vitest";

import {
  reviewStart,
  run,
  runComplete,
  taskNew,
} from "../../src/core/reducer.js";
import { project } from "../../src/core/projector.js";
import { getLifecycle } from "../../src/store/query.js";
import { createMigratedDatabase } from "../store/helpers.js";
import {
  L3_EXECUTE_RESULT,
  L3_INTEGRATE_RESULT,
  L3_INTEGRATE_RESULT_PLAIN,
  passReview,
  reviewInput,
  setupL3ToFeasibility,
} from "./l3-utils.js";

describe("projector L3 graph", () => {
  it("materializes the L3 graph for task new --level 3 and projects queued", () => {
    const db = createMigratedDatabase();

    try {
      const { taskId } = taskNew(db, {
        title: "L3 card",
        level: 3,
        reason: "reason",
      });

      const graph = getLifecycle(db, taskId, 1);
      expect(graph.nodes.map((node) => [node.id, node.kind])).toEqual([
        ["frame-1", "frame"],
        ["plan-1", "plan"],
        ["review-plan-1", "review"],
        ["execute-1", "execute"],
        ["review-execute-1", "review"],
        ["integrate-1", "integrate"],
        ["review-integrate-1", "review"],
        ["record-1", "record"],
      ]);
      expect(
        graph.edges.map((edge) => [edge.fromNodeId, edge.toNodeId]),
      ).toEqual([
        ["execute-1", "review-execute-1"],
        ["frame-1", "plan-1"],
        ["integrate-1", "review-integrate-1"],
        ["plan-1", "review-plan-1"],
        ["review-execute-1", "integrate-1"],
        ["review-integrate-1", "record-1"],
        ["review-plan-1", "execute-1"],
      ]);
      expect(graph.obligations.map((obligation) => obligation.id)).toEqual([
        "minimum-validation-recorded",
        "requested-outcome-produced",
        "frame-completed",
        "integration-completed",
        "plan-completed",
        "result-and-scope-retained",
        "delivery-completed",
        "integration-review-completed",
        "feasibility-completed",
      ]);

      const projection = project(db, taskId);
      expect(projection.status).toBe("queued");
      expect(projection.next).toBe(`tc run ${taskId} --node frame-1`);
      expect(projection.totalObligations).toBe(9);
    } finally {
      db.close();
    }
  });

  it("drives the full L3 loop through the reducer to done with the integration review", () => {
    const db = createMigratedDatabase();

    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(db);

      let review = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      passReview(db, taskId, review.reviewAttemptId, planAttemptId);

      let projection = project(db, taskId);
      expect(projection.next).toBe(`tc run ${taskId} --node execute-1`);
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({ nodeId: "execute-1", status: "runnable" }),
      );

      run(db, taskId, { nodeId: "execute-1" });
      runComplete(db, taskId, { result: L3_EXECUTE_RESULT });

      review = reviewStart(
        db,
        taskId,
        reviewInput(
          taskId,
          "review-execute-1",
          `att-${taskId}-execute-1-1`,
          "delivery",
        ),
      );
      passReview(
        db,
        taskId,
        review.reviewAttemptId,
        `att-${taskId}-execute-1-1`,
      );

      projection = project(db, taskId);
      expect(projection.next).toBe(`tc run ${taskId} --node integrate-1`);

      run(db, taskId, { nodeId: "integrate-1" });
      runComplete(db, taskId, {
        nodeId: "integrate-1",
        result: L3_INTEGRATE_RESULT,
      });

      // modifiedDeliverables: true opens the on-demand integration review.
      projection = project(db, taskId);
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({
          nodeId: "review-integrate-1",
          status: "runnable",
        }),
      );
      expect(projection.next).toBe(
        `tc review start ${taskId} --node review-integrate-1 --purpose integration --reviewed-attempt att-${taskId}-integrate-1-1`,
      );

      review = reviewStart(
        db,
        taskId,
        reviewInput(
          taskId,
          "review-integrate-1",
          `att-${taskId}-integrate-1-1`,
          "integration",
        ),
      );
      passReview(
        db,
        taskId,
        review.reviewAttemptId,
        `att-${taskId}-integrate-1-1`,
      );

      run(db, taskId, { nodeId: "record-1" });
      runComplete(db, taskId, {
        nodeId: "record-1",
        result: { summary: "Recorded" },
      });

      const done = project(db, taskId);
      expect(done.status).toBe("done");
      expect(done.next).toBeNull();
      expect(done.doneObligations).toBe(9);
      expect(
        done.nodeStatuses.map((node) => [node.nodeId, node.status]),
      ).toEqual([
        ["frame-1", "satisfied"],
        ["plan-1", "satisfied"],
        ["review-plan-1", "satisfied"],
        ["execute-1", "satisfied"],
        ["review-execute-1", "satisfied"],
        ["integrate-1", "satisfied"],
        ["review-integrate-1", "satisfied"],
        ["record-1", "satisfied"],
      ]);
    } finally {
      db.close();
    }
  });

  it("skips the integration review and goes straight to record when nothing was modified", () => {
    const db = createMigratedDatabase();

    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(db);

      let review = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      passReview(db, taskId, review.reviewAttemptId, planAttemptId);
      run(db, taskId, { nodeId: "execute-1" });
      runComplete(db, taskId, { result: L3_EXECUTE_RESULT });
      review = reviewStart(
        db,
        taskId,
        reviewInput(
          taskId,
          "review-execute-1",
          `att-${taskId}-execute-1-1`,
          "delivery",
        ),
      );
      passReview(
        db,
        taskId,
        review.reviewAttemptId,
        `att-${taskId}-execute-1-1`,
      );
      run(db, taskId, { nodeId: "integrate-1" });
      runComplete(db, taskId, {
        nodeId: "integrate-1",
        result: L3_INTEGRATE_RESULT_PLAIN,
      });

      const projection = project(db, taskId);
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({
          nodeId: "review-integrate-1",
          status: "blocked",
        }),
      );
      expect(projection.runnableNodes).toEqual(["record-1"]);
      expect(projection.next).toBe(`tc run ${taskId} --node record-1`);

      run(db, taskId, { nodeId: "record-1" });
      runComplete(db, taskId, {
        nodeId: "record-1",
        result: { summary: "Recorded" },
      });
      // The skipped integration review leaves its obligation vacuous, so the
      // task can still close.
      expect(project(db, taskId).status).toBe("done");
    } finally {
      db.close();
    }
  });
});
