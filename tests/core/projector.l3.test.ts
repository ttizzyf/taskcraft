import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import {
  reviewStart,
  run,
  runComplete,
  taskNew,
} from "../../src/core/reducer.js";
import { project } from "../../src/core/projector.js";
import {
  getAttempts,
  getInheritedPlanning,
  getLifecycle,
  getTask,
  getTaskRelations,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import {
  completeModuleChildren,
  integrateResult,
  L3_EXECUTE_RESULT,
  L3_SINGLE_PLAN_RESULT,
  passReview,
  reviewInput,
  setupL3ToFeasibility,
} from "./l3-utils.js";

describe("projector L3 modular graph", () => {
  it("creates only the L3 planning revision at task creation", () => {
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
      ]);
      expect(
        graph.edges.map((edge) => [edge.fromNodeId, edge.toNodeId]),
      ).toEqual([
        ["frame-1", "plan-1"],
        ["plan-1", "review-plan-1"],
      ]);
      const projection = project(db, taskId);
      expect(projection.status).toBe("queued");
      expect(projection.next).toBe(`tc run ${taskId} --node frame-1`);
      expect(projection.totalObligations).toBe(3);
    } finally {
      db.close();
    }
  });

  it("materializes real children, honors explicit dependencies and integrates them", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(db);
      const feasibility = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      const accepted = passReview(
        db,
        taskId,
        feasibility.reviewAttemptId,
        planAttemptId,
      );

      expect(accepted).toMatchObject({
        newRevision: 2,
        l3Mode: "modules",
        materializedChildren: [
          { moduleKey: "contract", taskId: "T-2", level: 2 },
          { moduleKey: "projection", taskId: "T-3", level: 1 },
        ],
      });
      expect(getTask(db, "T-2")?.parentTaskId).toBe(taskId);
      expect(getTask(db, "T-3")?.parentTaskId).toBe(taskId);
      expect(getLifecycle(db, taskId, 2).nodes.map((node) => node.id)).toEqual([
        "integrate-1",
        "review-integrate-1",
        "record-1",
      ]);
      expect(getLifecycle(db, "T-2", 1).nodes.map((node) => node.id)).toEqual([
        "execute-1",
        "review-1",
        "record-1",
      ]);
      expect(getAttempts(db, "T-2")).toEqual([]);
      expect(getInheritedPlanning(db, "T-2", 1)).toMatchObject({
        parentTaskId: taskId,
        sourcePlanAttemptId: planAttemptId,
      });

      let projection = project(db, taskId);
      expect(projection.children).toHaveLength(2);
      expect(projection.runnableWorkItems.map((item) => item.taskId)).toEqual([
        "T-2",
      ]);
      expect(projection.next).toBe("tc run T-2");
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({ nodeId: "integrate-1", status: "blocked" }),
      );
      expect(getTaskRelations(db, taskId, 2).dependencies).toEqual([
        expect.objectContaining({ taskId: "T-3", dependsOnTaskId: "T-2" }),
      ]);
      expect(project(db, "T-3")).toMatchObject({
        status: "queued",
        next: null,
        runnableNodes: [],
      });
      expect(captureTaskcraftError(() => run(db, "T-3")).code).toBe(
        ERROR_CODES.TC_ATTEMPT_REF_INVALID,
      );

      const childTaskIds = completeModuleChildren(db, taskId);
      projection = project(db, taskId);
      expect(projection.next).toBe(`tc run ${taskId} --node integrate-1`);
      expect(
        projection.children.every((child) => child.status === "done"),
      ).toBe(true);

      run(db, taskId, { nodeId: "integrate-1" });
      runComplete(db, taskId, {
        nodeId: "integrate-1",
        result: integrateResult(db, childTaskIds, true),
      });
      const integrationReview = reviewStart(
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
        integrationReview.reviewAttemptId,
        `att-${taskId}-integrate-1-1`,
      );
      run(db, taskId, { nodeId: "record-1" });
      runComplete(db, taskId, {
        nodeId: "record-1",
        result: { summary: "Recorded" },
      });
      expect(project(db, taskId).status).toBe("done");
    } finally {
      db.close();
    }
  });

  it("keeps a justified single L3 on the parent execution path", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(
        db,
        L3_SINGLE_PLAN_RESULT,
      );
      const feasibility = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      const accepted = passReview(
        db,
        taskId,
        feasibility.reviewAttemptId,
        planAttemptId,
      );
      expect(accepted).toMatchObject({
        l3Mode: "single",
        materializedChildren: [],
      });
      expect(project(db, taskId).next).toBe(
        `tc run ${taskId} --node execute-1`,
      );

      run(db, taskId, { nodeId: "execute-1" });
      runComplete(db, taskId, { result: L3_EXECUTE_RESULT });
      const delivery = reviewStart(
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
        delivery.reviewAttemptId,
        `att-${taskId}-execute-1-1`,
      );
      run(db, taskId, { nodeId: "integrate-1" });
      runComplete(db, taskId, {
        nodeId: "integrate-1",
        result: {
          childrenResults: [],
          integrationEvidence: [],
          modifiedDeliverables: false,
        },
      });
      expect(project(db, taskId).next).toBe(`tc run ${taskId} --node record-1`);
    } finally {
      db.close();
    }
  });
});
