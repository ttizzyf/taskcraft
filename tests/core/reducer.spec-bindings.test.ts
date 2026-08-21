import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import {
  reviewPass,
  reviewStart,
  run,
  runComplete,
  taskNew,
} from "../../src/core/reducer.js";
import {
  getAttempts,
  getLifecycleSpecBindings,
  getTask,
  getTaskRelations,
  listTasks,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import {
  L3_FRAME_RESULT,
  L3_PLAN_RESULT,
  L3_SINGLE_PLAN_RESULT,
  reviewInput,
  replanAcceptedModules,
  setupL3ToFeasibility,
} from "./l3-utils.js";
import { L2_FRAME_RESULT } from "./reducer-utils.js";

const STORE_SPEC = {
  specId: "engineering.store",
  kind: "engineering" as const,
  path: "docs/store.md",
  digest: "a".repeat(64),
  duty: "required" as const,
};
const CLI_SPEC = {
  specId: "engineering.cli",
  kind: "engineering" as const,
  path: "docs/cli.md",
  digest: "b".repeat(64),
  duty: "recommended" as const,
};

describe("Spec binding reducer flow", () => {
  it("binds task creation and L2 Frame selection to the exact nodes", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "L2 Specs",
        level: 2,
        reason: "separate framing",
        initialSpecBindings: [STORE_SPEC],
      });
      expect(getLifecycleSpecBindings(database, taskId, 1)).toEqual([
        expect.objectContaining({
          nodeId: "frame-1",
          specId: STORE_SPEC.specId,
          sourceKind: "task_create",
        }),
      ]);

      run(database, taskId, { nodeId: "frame-1" });
      runComplete(database, taskId, {
        nodeId: "frame-1",
        result: {
          ...L2_FRAME_RESULT,
          specBindings: [{ id: CLI_SPEC.specId, duty: CLI_SPEC.duty }],
        },
        resolvedSpecBindings: [CLI_SPEC],
      });
      const downstream = getLifecycleSpecBindings(database, taskId, 1).filter(
        (binding) => binding.nodeId !== "frame-1",
      );
      expect(downstream.map((binding) => binding.nodeId)).toEqual([
        "execute-1",
        "record-1",
        "review-1",
      ]);
      expect(
        downstream.every(
          (binding) =>
            binding.specId === CLI_SPEC.specId &&
            binding.sourceKind === "frame" &&
            binding.sourceAttemptId === `att-${taskId}-frame-1-1`,
        ),
      ).toBe(true);
    } finally {
      database.close();
    }
  });

  it("atomically materializes accepted L3 parent and inherited child bindings", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "L3 Specs",
        level: 3,
        reason: "module contract",
        initialSpecBindings: [STORE_SPEC],
      });
      run(database, taskId, { nodeId: "frame-1" });
      runComplete(database, taskId, {
        nodeId: "frame-1",
        result: L3_FRAME_RESULT,
      });
      const plan = {
        ...L3_PLAN_RESULT,
        executionSpecs: [{ id: CLI_SPEC.specId, duty: CLI_SPEC.duty }],
        modules: L3_PLAN_RESULT.modules.map((module, index) => ({
          ...module,
          specBindings:
            index === 0
              ? [{ id: STORE_SPEC.specId, duty: STORE_SPEC.duty }]
              : [{ id: CLI_SPEC.specId, duty: CLI_SPEC.duty }],
        })),
      };
      run(database, taskId, { nodeId: "plan-1" });
      runComplete(database, taskId, { nodeId: "plan-1", result: plan });
      const planAttemptId = `att-${taskId}-plan-1-1`;
      const review = reviewStart(
        database,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      reviewPass(database, taskId, {
        taskId,
        attemptId: review.reviewAttemptId,
        reviewedAttemptId: planAttemptId,
        evidence: [
          { type: "validation", reference: "ref://review", summary: "valid" },
        ],
        acceptedPlanSpecBindings: {
          execution: [CLI_SPEC],
          modules: { contract: [STORE_SPEC], projection: [CLI_SPEC] },
        },
      });

      const parentBindings = getLifecycleSpecBindings(database, taskId, 2);
      expect(parentBindings).toHaveLength(3);
      expect(
        parentBindings.every(
          (binding) =>
            binding.sourceKind === "accepted_plan" &&
            binding.sourceAttemptId === planAttemptId,
        ),
      ).toBe(true);
      const children = getTaskRelations(database, taskId, 2).children;
      expect(children).toHaveLength(2);
      for (const child of children) {
        const rows = getLifecycleSpecBindings(database, child.childTaskId, 1);
        expect(
          database
            .prepare(
              "SELECT compiler_version AS compilerVersion FROM lifecycle_revisions WHERE task_id = ? AND revision = 1",
            )
            .get(child.childTaskId),
        ).toEqual({ compilerVersion: "tc-l3-child/2" });
        expect(rows.length).toBe(child.moduleKey === "contract" ? 3 : 2);
        expect(
          rows.every(
            (binding) =>
              binding.sourceKind === "inherited_plan" &&
              binding.sourceTaskId === taskId &&
              binding.sourceAttemptId === planAttemptId,
          ),
        ).toBe(true);
      }
      expect(
        getAttempts(database, children[0]!.childTaskId).filter((attempt) =>
          ["frame-1", "plan-1"].includes(attempt.nodeId),
        ),
      ).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("binds L3 single execution without manufacturing a child", () => {
    const database = createMigratedDatabase();
    try {
      const plan = {
        ...L3_SINGLE_PLAN_RESULT,
        executionSpecs: [{ id: STORE_SPEC.specId, duty: STORE_SPEC.duty }],
      };
      const { taskId, planAttemptId } = setupL3ToFeasibility(database, plan);
      const review = reviewStart(
        database,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      reviewPass(database, taskId, {
        taskId,
        attemptId: review.reviewAttemptId,
        reviewedAttemptId: planAttemptId,
        evidence: [
          { type: "validation", reference: "ref://review", summary: "valid" },
        ],
        acceptedPlanSpecBindings: { execution: [STORE_SPEC], modules: {} },
      });

      expect(
        getTaskRelations(database, taskId, 2).executionSource,
      ).toMatchObject({
        mode: "single",
      });
      expect(getTaskRelations(database, taskId, 2).children).toEqual([]);
      expect(getLifecycleSpecBindings(database, taskId, 2)).toHaveLength(5);
    } finally {
      database.close();
    }
  });

  it("rolls back feasibility pass when resolved Spec snapshots mismatch", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Atomic L3",
        level: 3,
        reason: "rollback",
      });
      run(database, taskId, { nodeId: "frame-1" });
      runComplete(database, taskId, {
        nodeId: "frame-1",
        result: L3_FRAME_RESULT,
      });
      const plan = {
        ...L3_PLAN_RESULT,
        executionSpecs: [{ id: CLI_SPEC.specId, duty: CLI_SPEC.duty }],
      };
      run(database, taskId, { nodeId: "plan-1" });
      runComplete(database, taskId, { nodeId: "plan-1", result: plan });
      const planAttemptId = `att-${taskId}-plan-1-1`;
      const review = reviewStart(
        database,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      const error = captureTaskcraftError(() =>
        reviewPass(database, taskId, {
          taskId,
          attemptId: review.reviewAttemptId,
          reviewedAttemptId: planAttemptId,
          evidence: [
            { type: "validation", reference: "ref://review", summary: "valid" },
          ],
          acceptedPlanSpecBindings: {
            execution: [STORE_SPEC],
            modules: { contract: [], projection: [] },
          },
        }),
      );
      expect(error.code).toBe(ERROR_CODES.TC_SPEC_BINDING_INVALID);
      const missing = captureTaskcraftError(() =>
        reviewPass(database, taskId, {
          taskId,
          attemptId: review.reviewAttemptId,
          reviewedAttemptId: planAttemptId,
          evidence: [
            { type: "validation", reference: "ref://review", summary: "valid" },
          ],
        }),
      );
      expect(missing.code).toBe(ERROR_CODES.TC_SPEC_BINDING_INVALID);
      expect(getTask(database, taskId)!.currentLifecycleRevision).toBe(1);
      expect(getTaskRelations(database, taskId, 2).children).toEqual([]);
      expect(getLifecycleSpecBindings(database, taskId, 2)).toEqual([]);
      expect(
        getAttempts(database, taskId).find(
          (attempt) => attempt.id === review.reviewAttemptId,
        ),
      ).toMatchObject({ status: "created", outcome: null });
    } finally {
      database.close();
    }
  });

  it("rejects reusable children whose Spec id/duty set changed", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = replanAcceptedModules(database);
      const plan = {
        ...L3_PLAN_RESULT,
        modules: L3_PLAN_RESULT.modules.map((module, index) =>
          index === 0
            ? {
                ...module,
                reuseTaskId: "T-2",
                specBindings: [
                  { id: STORE_SPEC.specId, duty: STORE_SPEC.duty },
                ],
              }
            : module,
        ),
      };
      run(database, taskId, { nodeId: "frame-1" });
      runComplete(database, taskId, {
        nodeId: "frame-1",
        result: L3_FRAME_RESULT,
      });
      run(database, taskId, { nodeId: "plan-1" });
      runComplete(database, taskId, { nodeId: "plan-1", result: plan });
      const planAttemptId = `att-${taskId}-plan-1-2`;
      const review = reviewStart(
        database,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      const error = captureTaskcraftError(() =>
        reviewPass(database, taskId, {
          taskId,
          attemptId: review.reviewAttemptId,
          reviewedAttemptId: planAttemptId,
          evidence: [
            { type: "validation", reference: "ref://review", summary: "valid" },
          ],
          acceptedPlanSpecBindings: {
            execution: [],
            modules: { contract: [STORE_SPEC], projection: [] },
          },
        }),
      );
      expect(error.code).toBe(ERROR_CODES.TC_L3_PLAN_INVALID);
      expect(error.problem).toContain("specBindings changed");
      expect(getTask(database, taskId)!.currentLifecycleRevision).toBe(3);
      expect(listTasks(database).map((task) => task.id)).toEqual([
        "T-1",
        "T-2",
        "T-3",
      ]);
    } finally {
      database.close();
    }
  });
});
