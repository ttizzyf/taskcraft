import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import {
  reviewPass,
  reviewStart,
  run,
  runComplete,
  taskNew,
  taskSpecRefresh,
} from "../../src/core/reducer.js";
import {
  getAttempts,
  getLifecycleSpecBindings,
  getTask,
  getTaskRelations,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import {
  L3_FRAME_RESULT,
  L3_PLAN_RESULT,
  passReview,
  reviewInput,
  setupL3ToFeasibility,
} from "./l3-utils.js";

const STORE_SPEC = {
  specId: "engineering.store",
  kind: "engineering" as const,
  path: "docs/store.md",
  digest: "a".repeat(64),
  duty: "required" as const,
};

describe("Spec binding refresh and reuse", () => {
  it("rejects reusable children whose stored Spec snapshot drifted", () => {
    const database = createMigratedDatabase();
    try {
      const initialPlan = {
        ...L3_PLAN_RESULT,
        modules: L3_PLAN_RESULT.modules.map((module, index) => ({
          ...module,
          specBindings:
            index === 0
              ? [{ id: STORE_SPEC.specId, duty: STORE_SPEC.duty }]
              : [],
        })),
      };
      const { taskId, planAttemptId } = setupL3ToFeasibility(
        database,
        initialPlan,
      );
      const firstReview = reviewStart(
        database,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      reviewPass(database, taskId, {
        taskId,
        attemptId: firstReview.reviewAttemptId,
        reviewedAttemptId: planAttemptId,
        evidence: [
          { type: "validation", reference: "ref://review", summary: "valid" },
        ],
        acceptedPlanSpecBindings: {
          execution: [],
          modules: { contract: [STORE_SPEC], projection: [] },
        },
      });
      taskSpecRefresh(database, taskId, {
        reason: "Re-evaluate the module contract",
        resolvedSpecBindings: [],
      });

      run(database, taskId, { nodeId: "frame-1" });
      runComplete(database, taskId, {
        nodeId: "frame-1",
        result: L3_FRAME_RESULT,
      });
      const reusedPlan = {
        ...initialPlan,
        modules: initialPlan.modules.map((module, index) =>
          index === 0 ? { ...module, reuseTaskId: "T-2" } : module,
        ),
      };
      run(database, taskId, { nodeId: "plan-1" });
      runComplete(database, taskId, {
        nodeId: "plan-1",
        result: reusedPlan,
      });
      const secondPlanAttemptId = `att-${taskId}-plan-1-2`;
      const secondReview = reviewStart(
        database,
        taskId,
        reviewInput(
          taskId,
          "review-plan-1",
          secondPlanAttemptId,
          "feasibility",
        ),
      );
      const changedDigest = { ...STORE_SPEC, digest: "c".repeat(64) };
      const error = captureTaskcraftError(() =>
        reviewPass(database, taskId, {
          taskId,
          attemptId: secondReview.reviewAttemptId,
          reviewedAttemptId: secondPlanAttemptId,
          evidence: [
            {
              type: "validation",
              reference: "ref://review",
              summary: "valid",
            },
          ],
          acceptedPlanSpecBindings: {
            execution: [],
            modules: { contract: [changedDigest], projection: [] },
          },
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_L3_PLAN_INVALID);
      expect(error.problem).toContain("specBindings changed");
      expect(getTask(database, taskId)!.currentLifecycleRevision).toBe(3);
      expect(getLifecycleSpecBindings(database, "T-2", 1)[0]).toMatchObject({
        specDigest: STORE_SPEC.digest,
      });
    } finally {
      database.close();
    }
  });

  it("refreshes into a new revision without mutating or stopping old attempts", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Refresh",
        level: 1,
        reason: "bound contract",
        initialSpecBindings: [STORE_SPEC],
      });
      run(database, taskId);
      const refreshed = { ...STORE_SPEC, digest: "c".repeat(64) };
      const result = taskSpecRefresh(database, taskId, {
        reason: "Spec digest changed",
        resolvedSpecBindings: [refreshed],
        expectedRevision: 2,
      });

      expect(result).toMatchObject({
        refreshedTaskId: taskId,
        newRevision: 2,
        next: `tc run ${taskId} --node execute-1`,
      });
      expect(getAttempts(database, taskId)[0]).toMatchObject({
        lifecycleRevision: 1,
        status: "created",
      });
      expect(
        getLifecycleSpecBindings(database, taskId, 1, "execute-1")[0]!
          .specDigest,
      ).toBe(STORE_SPEC.digest);
      expect(
        getLifecycleSpecBindings(database, taskId, 2, "execute-1")[0],
      ).toMatchObject({ specDigest: refreshed.digest, sourceKind: "refresh" });
    } finally {
      database.close();
    }
  });

  it("rejects refresh snapshots that change the current confirmed Spec set", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Refresh set",
        level: 1,
        reason: "bound contract",
        initialSpecBindings: [STORE_SPEC],
      });
      const error = captureTaskcraftError(() =>
        taskSpecRefresh(database, taskId, {
          reason: "Do not silently drop the contract",
          resolvedSpecBindings: [],
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_SPEC_BINDING_INVALID);
      expect(getTask(database, taskId)).toMatchObject({
        currentLifecycleRevision: 1,
        revision: 1,
      });
      expect(getLifecycleSpecBindings(database, taskId, 2)).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("routes inherited-child refresh to the root Plan and preserves runtime facts", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(database);
      const feasibility = reviewStart(
        database,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      passReview(database, taskId, feasibility.reviewAttemptId, planAttemptId);
      const child = getTaskRelations(database, taskId, 2).children[0]!
        .childTaskId;
      run(database, child, { nodeId: "execute-1" });

      const refreshed = taskSpecRefresh(database, child, {
        reason: "Inherited module Spec changed",
        resolvedSpecBindings: [],
        expectedRevision: 2,
      });

      expect(refreshed).toMatchObject({
        requestedTaskId: child,
        refreshedTaskId: taskId,
        newRevision: 3,
        next: `tc run ${taskId} --node frame-1`,
      });
      expect(getTask(database, child)).toMatchObject({
        currentLifecycleRevision: 1,
        revision: 3,
      });
      expect(getAttempts(database, child)[0]).toMatchObject({
        status: "created",
        outcome: null,
      });
      expect(
        getTaskRelations(database, taskId, 3).children.every(
          (requirement) => requirement.requirementStatus === "not_required",
        ),
      ).toBe(true);
    } finally {
      database.close();
    }
  });
});
