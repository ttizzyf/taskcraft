import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { project } from "../../src/core/projector.js";
import {
  cancel,
  reviewReplan,
  reviewStart,
  run,
  runComplete,
  taskResume,
  taskNew,
  taskWait,
} from "../../src/core/reducer.js";
import {
  getAttempts,
  getEvidence,
  getInheritedPlanning,
  getTask,
  getTaskRelations,
  listTasks,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import {
  L3_PLAN_RESULT,
  L3_EXECUTE_RESULT,
  L3_FRAME_RESULT,
  L3_SINGLE_PLAN_RESULT,
  passReview,
  replanAcceptedModules,
  reviewInput,
  setupL3ToFeasibility,
} from "./l3-utils.js";

describe("L3 accepted-plan transaction", () => {
  it.each([
    {
      name: "single without attempted split",
      plan: {
        ...L3_SINGLE_PLAN_RESULT,
        decomposition: {
          ...L3_SINGLE_PLAN_RESULT.decomposition,
          attemptedSplits: [],
        },
      },
    },
    {
      name: "required anchor without coverage",
      plan: {
        ...L3_PLAN_RESULT,
        coverage: L3_PLAN_RESULT.coverage.map((coverage) =>
          coverage.anchorId === "A-02"
            ? { ...coverage, moduleKeys: [] }
            : coverage,
        ),
      },
    },
    {
      name: "dependency cycle",
      plan: {
        ...L3_PLAN_RESULT,
        dependencies: [
          ...L3_PLAN_RESULT.dependencies,
          { task: "contract", dependsOn: "projection" },
        ],
      },
    },
  ])("rejects $name without accepting the review", ({ plan }) => {
    const db = createMigratedDatabase();
    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(db, plan);
      const review = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      const before = getTask(db, taskId)!;
      const error = captureTaskcraftError(() =>
        passReview(db, taskId, review.reviewAttemptId, planAttemptId),
      );

      expect(error.code).toBe(ERROR_CODES.TC_L3_PLAN_INVALID);
      expect(getTask(db, taskId)).toMatchObject({
        revision: before.revision,
        currentLifecycleRevision: 1,
      });
      expect(listTasks(db)).toHaveLength(1);
      expect(
        getEvidence(db, taskId).filter(
          (row) => row.nodeAttemptId === review.reviewAttemptId,
        ),
      ).toEqual([]);
      expect(
        getAttempts(db, taskId).find(({ id }) => id === review.reviewAttemptId)
          ?.status,
      ).toBe("created");
    } finally {
      db.close();
    }
  });

  it("rolls back every child when a later child insert fails", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(db);
      const review = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      db.exec(
        `CREATE TRIGGER fail_second_child BEFORE INSERT ON tasks
         WHEN NEW.title = 'Child projection'
         BEGIN SELECT RAISE(ABORT, 'injected child failure'); END`,
      );

      const error = captureTaskcraftError(() =>
        passReview(db, taskId, review.reviewAttemptId, planAttemptId),
      );
      expect(error.code).toBe(ERROR_CODES.TC_STORE_TRANSACTION_FAILED);
      expect(listTasks(db).map((task) => task.id)).toEqual([taskId]);
      expect(getTask(db, taskId)).toMatchObject({
        currentLifecycleRevision: 1,
      });
      expect(
        db
          .prepare("SELECT COUNT(*) AS count FROM lifecycle_child_requirements")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("propagates a real child waiting/resume path through the parent", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(db);
      const review = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      passReview(db, taskId, review.reviewAttemptId, planAttemptId);

      run(db, "T-2", { nodeId: "execute-1" });
      taskWait(db, "T-2", {
        reasonCode: "needs_input",
        message: "Need the schema decision",
      });
      expect(project(db, taskId)).toMatchObject({
        status: "waiting",
        waitingReason: "needs_input",
        next: "tc task resume T-2",
      });

      taskResume(db, "T-2", { resolve: true });
      expect(project(db, taskId)).toMatchObject({
        status: "active",
        next: "tc run T-2 --node execute-1",
      });
    } finally {
      db.close();
    }
  });

  it("routes an unfinished inherited child replan back to the parent Plan", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(db);
      const feasibility = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      passReview(db, taskId, feasibility.reviewAttemptId, planAttemptId);
      run(db, "T-2", { nodeId: "execute-1" });
      runComplete(db, "T-2", { result: L3_EXECUTE_RESULT });
      const childReview = reviewStart(
        db,
        "T-2",
        reviewInput("T-2", "review-1", "att-T-2-execute-1-1", "delivery"),
      );
      const siblingBefore = getTask(db, "T-3")!;

      const replanned = reviewReplan(db, "T-2", {
        taskId: "T-2",
        attemptId: childReview.reviewAttemptId,
        reviewedAttemptId: "att-T-2-execute-1-1",
        reasonCode: "contract_changed",
        finding: "The parent module boundary must change",
      });

      expect(replanned).toMatchObject({
        taskId,
        newRevision: 3,
        status: "active",
        next: `tc run ${taskId} --node frame-1`,
      });
      expect(getTask(db, taskId)?.currentLifecycleRevision).toBe(3);
      expect(
        getTaskRelations(db, taskId, 3).children.map((child) => [
          child.childTaskId,
          child.requirementStatus,
        ]),
      ).toEqual([
        ["T-2", "not_required"],
        ["T-3", "not_required"],
      ]);
      expect(getAttempts(db, "T-2")).toContainEqual(
        expect.objectContaining({
          id: childReview.reviewAttemptId,
          status: "superseded",
          outcome: "superseded",
        }),
      );
      expect(getEvidence(db, "T-2")).not.toHaveLength(0);
      expect(getTask(db, "T-3")).toEqual(siblingBefore);
      expect(project(db, taskId).runnableWorkItems).toEqual([
        expect.objectContaining({ taskId, parentTaskId: null }),
      ]);
      expect(project(db, "T-2")).toMatchObject({
        status: "active",
        next: "tc review start T-2 --node review-1 --purpose delivery --reviewed-attempt att-T-2-execute-1-1",
      });
    } finally {
      db.close();
    }
  });

  it("refuses to cancel a parent with unfinished required children and never cascades", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(db);
      const review = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      passReview(db, taskId, review.reviewAttemptId, planAttemptId);

      const error = captureTaskcraftError(() =>
        cancel(db, taskId, { reason: "stop parent" }),
      );
      expect(error.code).toBe(ERROR_CODES.TC_TASK_CHILDREN_UNRESOLVED);
      expect(getTask(db, taskId)?.cancelledAt).toBeNull();
      expect(getTask(db, "T-2")?.cancelledAt).toBeNull();
      expect(getTask(db, "T-3")?.cancelledAt).toBeNull();
    } finally {
      db.close();
    }
  });

  it("rejects Level 3 module proposals at the Plan schema boundary", () => {
    const db = createMigratedDatabase();
    try {
      const invalid = {
        ...L3_PLAN_RESULT,
        modules: L3_PLAN_RESULT.modules.map((module, index) =>
          index === 0 ? { ...module, level: 3 } : module,
        ),
      };
      const { taskId } = taskNew(db, {
        title: "Invalid nested L3",
        level: 3,
        reason: "test",
      });
      run(db, taskId, { nodeId: "frame-1" });
      runComplete(db, taskId, {
        nodeId: "frame-1",
        result: L3_FRAME_RESULT,
      });
      run(db, taskId, { nodeId: "plan-1" });
      const error = captureTaskcraftError(() =>
        runComplete(db, taskId, { nodeId: "plan-1", result: invalid }),
      );
      expect(error.code).toBe(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID);
    } finally {
      db.close();
    }
  });

  it("reuses an exact historical child while preserving replaced child history", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId, originalPlanAttemptId } = replanAcceptedModules(db);
      const reusedEvidence = getEvidence(db, "T-2").map((row) => row.id);
      const reusedAttempts = getAttempts(db, "T-2").map((row) => row.id);
      const replanned = {
        ...L3_PLAN_RESULT,
        modules: L3_PLAN_RESULT.modules.map((module, index) =>
          index === 0 ? { ...module, reuseTaskId: "T-2" } : module,
        ),
      };

      run(db, taskId, { nodeId: "frame-1" });
      runComplete(db, taskId, {
        nodeId: "frame-1",
        result: L3_FRAME_RESULT,
      });
      run(db, taskId, { nodeId: "plan-1" });
      runComplete(db, taskId, { nodeId: "plan-1", result: replanned });
      const newPlanAttemptId = `att-${taskId}-plan-1-2`;
      const review = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", newPlanAttemptId, "feasibility"),
      );
      const accepted = passReview(
        db,
        taskId,
        review.reviewAttemptId,
        newPlanAttemptId,
      );

      expect(accepted.materializedChildren).toEqual([
        { moduleKey: "contract", taskId: "T-2", level: 2, reused: true },
        { moduleKey: "projection", taskId: "T-4", level: 1, reused: false },
      ]);
      expect(listTasks(db).map((task) => task.id)).toEqual([
        "T-1",
        "T-2",
        "T-3",
        "T-4",
      ]);
      expect(
        getTaskRelations(db, taskId, 3).children.map((child) => [
          child.childTaskId,
          child.requirementStatus,
        ]),
      ).toEqual([
        ["T-2", "not_required"],
        ["T-3", "not_required"],
      ]);
      expect(
        getTaskRelations(db, taskId, 4).children.map((child) => [
          child.childTaskId,
          child.requirementStatus,
        ]),
      ).toEqual([
        ["T-2", "required"],
        ["T-4", "required"],
      ]);
      expect(getAttempts(db, "T-2").map((row) => row.id)).toEqual(
        reusedAttempts,
      );
      expect(getEvidence(db, "T-2").map((row) => row.id)).toEqual(
        reusedEvidence,
      );
      expect(getInheritedPlanning(db, "T-2", 1)).toMatchObject({
        sourcePlanAttemptId: originalPlanAttemptId,
        parentLifecycleRevision: 2,
      });
      expect(project(db, taskId)).toMatchObject({
        status: "active",
        next: "tc run T-4",
        runnableWorkItems: [expect.objectContaining({ taskId: "T-4" })],
      });
    } finally {
      db.close();
    }
  });

  it("rejects reuse when the historical child contract no longer matches", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId } = replanAcceptedModules(db);
      const mismatched = {
        ...L3_PLAN_RESULT,
        modules: L3_PLAN_RESULT.modules.map((module, index) =>
          index === 0
            ? {
                ...module,
                reuseTaskId: "T-2",
                acceptance: ["A changed contract must not rewrite the child"],
              }
            : module,
        ),
      };
      run(db, taskId, { nodeId: "frame-1" });
      runComplete(db, taskId, {
        nodeId: "frame-1",
        result: L3_FRAME_RESULT,
      });
      run(db, taskId, { nodeId: "plan-1" });
      runComplete(db, taskId, { nodeId: "plan-1", result: mismatched });
      const planAttemptId = `att-${taskId}-plan-1-2`;
      const review = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );

      const error = captureTaskcraftError(() =>
        passReview(db, taskId, review.reviewAttemptId, planAttemptId),
      );

      expect(error.code).toBe(ERROR_CODES.TC_L3_PLAN_INVALID);
      expect(error.problem).toContain("acceptance changed");
      expect(getTask(db, taskId)?.currentLifecycleRevision).toBe(3);
      expect(listTasks(db).map((task) => task.id)).toEqual([
        "T-1",
        "T-2",
        "T-3",
      ]);
      expect(getAttempts(db, taskId)).toContainEqual(
        expect.objectContaining({
          id: review.reviewAttemptId,
          status: "created",
        }),
      );
    } finally {
      db.close();
    }
  });
});
