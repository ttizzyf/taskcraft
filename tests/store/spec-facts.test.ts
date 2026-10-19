import { describe, expect, it } from "vitest";

import {
  reviewStart,
  run,
  runComplete,
  taskNew,
} from "../../src/core/reducer.js";
import {
  getLifecycleSpecBindings,
  getSpecImpactResults,
  getTaskRelations,
} from "../../src/store/query.js";
import {
  passReview,
  reviewInput,
  setupL3ToFeasibility,
} from "../core/l3-utils.js";
import { createMigratedDatabase } from "./helpers.js";

const BINDING = {
  specId: "engineering.store",
  kind: "engineering" as const,
  path: "docs/store.md",
  duty: "required" as const,
};

describe("Spec lifecycle facts", () => {
  it("stores exact revision/node snapshots and does not backfill old rows", () => {
    const database = createMigratedDatabase();
    try {
      const legacy = taskNew(database, {
        title: "No Specs",
        level: 1,
        reason: "legacy-compatible empty binding set",
      });
      const bound = taskNew(database, {
        title: "Bound",
        level: 1,
        reason: "confirmed engineering contract",
        initialSpecBindings: [BINDING],
      });

      expect(getLifecycleSpecBindings(database, legacy.taskId)).toEqual([]);
      expect(getLifecycleSpecBindings(database, bound.taskId)).toEqual([
        expect.objectContaining({
          nodeId: "execute-1",
          specId: BINDING.specId,
          sourceKind: "task_create",
          sourceTaskId: null,
          sourceAttemptId: null,
        }),
        expect.objectContaining({
          nodeId: "record-1",
          specId: BINDING.specId,
          duty: "required",
        }),
      ]);
    } finally {
      database.close();
    }
  });

  it("rejects update/delete and records one immutable impact per Record attempt", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Impact",
        level: 1,
        reason: "record impact",
        initialSpecBindings: [BINDING],
      });
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Delivered",
          evidence: [
            {
              type: "validation",
              reference: "ref://validation",
              summary: "Validated",
            },
          ],
          record: {
            summary: "Recorded",
            specImpact: {
              outcome: "none",
              reason: "No reusable rule changed",
            },
          },
        },
      });

      expect(getSpecImpactResults(database, taskId)).toEqual([
        expect.objectContaining({
          recordAttemptId: `att-${taskId}-record-1-1`,
          outcome: "none",
        }),
      ]);
      expect(() =>
        database
          .prepare(
            "UPDATE lifecycle_spec_bindings SET duty = 'recommended' WHERE task_id = ?",
          )
          .run(taskId),
      ).toThrow(/append-only/);
      expect(() =>
        database
          .prepare("DELETE FROM lifecycle_spec_bindings WHERE task_id = ?")
          .run(taskId),
      ).toThrow(/append-only/);
      expect(() =>
        database
          .prepare(
            "UPDATE spec_impact_results SET outcome = 'candidate' WHERE task_id = ?",
          )
          .run(taskId),
      ).toThrow(/append-only/);
      expect(() =>
        database
          .prepare("DELETE FROM spec_impact_results WHERE task_id = ?")
          .run(taskId),
      ).toThrow(/append-only/);
    } finally {
      database.close();
    }
  });

  it("rejects inherited binding provenance from a foreign parent Plan", () => {
    const database = createMigratedDatabase();
    try {
      const parent = setupL3ToFeasibility(database);
      const feasibility = reviewStart(
        database,
        parent.taskId,
        reviewInput(
          parent.taskId,
          "review-plan-1",
          parent.planAttemptId,
          "feasibility",
        ),
      );
      passReview(
        database,
        parent.taskId,
        feasibility.reviewAttemptId,
        parent.planAttemptId,
      );
      const child = getTaskRelations(database, parent.taskId, 2).children[0]!
        .childTaskId;
      const foreign = setupL3ToFeasibility(database);

      expect(() =>
        database
          .prepare(
            `INSERT INTO lifecycle_spec_bindings (
               task_id, lifecycle_revision, node_id, spec_id, spec_kind,
               spec_path, duty, source_kind, source_task_id,
               source_attempt_id, created_by, created_at
             ) VALUES (?, 1, 'execute-1', 'engineering.foreign', 'engineering',
                       'docs/foreign.md', 'recommended', 'inherited_plan',
                       ?, ?, 'test', '2026-08-21T00:00:00.000Z')`,
          )
          .run(child, foreign.taskId, foreign.planAttemptId),
      ).toThrow(/Spec binding source must reference its Frame or Plan attempt/);
    } finally {
      database.close();
    }
  });

  it("rejects an accepted_plan source before an exact execution relation exists", () => {
    const database = createMigratedDatabase();
    try {
      const parent = setupL3ToFeasibility(database);

      expect(() =>
        database
          .prepare(
            `INSERT INTO lifecycle_spec_bindings (
               task_id, lifecycle_revision, node_id, spec_id, spec_kind,
               spec_path, duty, source_kind, source_task_id,
               source_attempt_id, created_by, created_at
             ) VALUES (?, 1, 'frame-1', 'engineering.unaccepted', 'engineering',
                       'docs/unaccepted.md', 'required', 'accepted_plan',
                       ?, ?, 'test', '2026-08-21T00:00:00.000Z')`,
          )
          .run(parent.taskId, parent.taskId, parent.planAttemptId),
      ).toThrow(/Spec binding source must reference its Frame or Plan attempt/);
    } finally {
      database.close();
    }
  });

  it("rejects Spec Impact rows that do not reference a successful Record attempt", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Invalid impact",
        level: 1,
        reason: "composite reference",
      });
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Delivered",
          evidence: [
            {
              type: "validation",
              reference: "ref://validation",
              summary: "Validated",
            },
          ],
        },
      });

      expect(() =>
        database
          .prepare(
            `INSERT INTO spec_impact_results (
               record_attempt_id, task_id, lifecycle_revision, record_node_id,
               outcome, details_json, created_by, created_at
             ) VALUES (?, ?, 1, 'execute-1', 'none', '{}', 'test',
                       '2026-08-21T00:00:00.000Z')`,
          )
          .run(`att-${taskId}-execute-1-1`, taskId),
      ).toThrow(/Spec Impact must reference a successful Record attempt/);
      expect(getSpecImpactResults(database, taskId)).toEqual([]);
    } finally {
      database.close();
    }
  });
});
