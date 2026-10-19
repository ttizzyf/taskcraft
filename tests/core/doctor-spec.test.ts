import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runDoctorChecks, type DoctorCheck } from "../../src/core/doctor.js";
import { LEGACY_L1_EXECUTE_RESULT_SCHEMA } from "../../src/core/lifecycle/l1.js";
import {
  reviewPass,
  reviewStart,
  run,
  runComplete,
  taskNew,
} from "../../src/core/reducer.js";
import { getEvidence } from "../../src/store/query.js";
import type { TaskcraftDatabase } from "../../src/store/database.js";
import { createMigratedDatabase } from "../store/helpers.js";
import {
  L3_PLAN_RESULT,
  reviewInput,
  setupL3ToFeasibility,
} from "./l3-utils.js";

const MIGRATIONS_DIRECTORY = resolve("migrations");

describe("doctor Spec integrity", () => {
  it("checks binding facts without comparing them with a Registry", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Bound task",
        level: 1,
        reason: "doctor contract",
        initialSpecBindings: [
          {
            specId: "engineering.delivery",
            kind: "engineering",
            path: "docs/delivery.md",
            duty: "required",
          },
        ],
      });
      run(database, taskId, {});
      runComplete(database, taskId, {
        result: {
          summary: "Done",
          evidence: [
            { type: "validation", reference: "ref://test", summary: "Pass" },
          ],
          record: {
            summary: "Recorded",
            specImpact: { outcome: "none", reason: "No reusable rule" },
          },
        },
      });

      // A binding records what the task adopted. Whether the document still
      // says the same thing today is not a property of the store, so doctor
      // reports provenance only and stays green.
      expect(checkOf(database, "spec-bindings").ok).toBe(true);
    } finally {
      database.close();
    }
  });

  it("flags a missing Impact on a successful Record from an Impact compiler", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Missing Impact",
        level: 1,
        reason: "doctor contract",
      });
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Done",
          evidence: [
            { type: "validation", reference: "ref://test", summary: "Pass" },
          ],
          record: {
            summary: "Recorded",
            specImpact: { outcome: "none", reason: "No reusable rule" },
          },
        },
      });
      database.exec("DROP TRIGGER spec_impact_results_immutable_delete");
      database.prepare("DELETE FROM spec_impact_results").run();

      const check = checkOf(database, "spec-impact");
      expect(check.ok).toBe(false);
      expect(check.error?.code).toBe("TC_SPEC_IMPACT_INVALID");
      expect(check.error?.problem).toContain("missing Spec Impact");
    } finally {
      database.close();
    }
  });

  it("accepts a historical updated Impact after the Registry advances", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Historical updated Impact",
        level: 1,
        reason: "Registry history must remain auditable",
      });
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Done",
          evidence: [
            { type: "validation", reference: "ref://test", summary: "Pass" },
          ],
        },
      });
      const evidenceId = getEvidence(database, taskId)[0]!.id;
      run(database, taskId, { nodeId: "record-1" });
      const impact = {
        outcome: "updated" as const,
        updates: [
          {
            specId: "engineering.delivery",
            path: "docs/delivery.md",
            evidenceRefs: [evidenceId],
          },
        ],
      };
      runComplete(database, taskId, {
        nodeId: "record-1",
        result: { summary: "Recorded", specImpact: impact },
        resolvedSpecImpact: impact,
      });

      const check = checkOf(database, "spec-impact");
      expect(check.ok).toBe(true);
    } finally {
      database.close();
    }
  });

  it("reads a Record result that still carries the retired Impact digest", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Retired digest",
        level: 1,
        reason: "historical records keep their own shape",
      });
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Done",
          evidence: [
            { type: "validation", reference: "ref://test", summary: "Pass" },
          ],
        },
      });
      const evidenceId = getEvidence(database, taskId)[0]!.id;
      run(database, taskId, { nodeId: "record-1" });
      const impact = {
        outcome: "updated" as const,
        updates: [
          {
            specId: "engineering.delivery",
            path: "docs/delivery.md",
            evidenceRefs: [evidenceId],
          },
        ],
      };
      runComplete(database, taskId, {
        nodeId: "record-1",
        result: { summary: "Recorded", specImpact: impact },
        resolvedSpecImpact: impact,
      });

      // Records written before digests were retired still carry the key, and
      // their stored schema still requires it. Reading such a record must not
      // report damage.
      const attemptId = `att-${taskId}-record-1-1`;
      database
        .prepare("UPDATE node_attempts SET result_json = ? WHERE id = ?")
        .run(
          JSON.stringify({
            summary: "Recorded",
            specImpact: {
              outcome: "updated",
              updates: [
                {
                  specId: "engineering.delivery",
                  path: "docs/delivery.md",
                  digest: "a".repeat(64),
                  evidenceRefs: [evidenceId],
                },
              ],
            },
          }),
          attemptId,
        );

      expect(checkOf(database, "spec-impact").ok).toBe(true);
    } finally {
      database.close();
    }
  });

  it("flags a missing satisfied Impact obligation result", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Missing Impact result",
        level: 1,
        reason: "doctor contract",
      });
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Done",
          evidence: [
            { type: "validation", reference: "ref://test", summary: "Pass" },
          ],
          record: {
            summary: "Recorded",
            specImpact: { outcome: "none", reason: "No reusable rule" },
          },
        },
      });
      database
        .prepare(
          `DELETE FROM obligation_results
           WHERE task_id = ? AND obligation_id = 'spec-impact-recorded'`,
        )
        .run(taskId);

      const check = checkOf(database, "spec-impact");
      expect(check.ok).toBe(false);
      expect(check.error?.problem).toContain(
        "missing satisfied Spec Impact obligation result",
      );
    } finally {
      database.close();
    }
  });

  it("flags a compiler whose inline Execute Record schema is from the wrong generation", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Mismatched inline schema",
        level: 1,
        reason: "doctor contract",
      });
      database.exec("DROP TRIGGER lifecycle_nodes_immutable_update");
      database
        .prepare(
          `UPDATE lifecycle_nodes SET output_schema_json = ?
           WHERE task_id = ? AND lifecycle_revision = 1 AND id = 'execute-1'`,
        )
        .run(JSON.stringify(LEGACY_L1_EXECUTE_RESULT_SCHEMA), taskId);

      const check = checkOf(database, "spec-impact");
      expect(check.ok).toBe(false);
      expect(check.error?.problem).toContain(
        "compiler/Execute Record schema mismatch",
      );
    } finally {
      database.close();
    }
  });

  it("flags updated Impact with foreign evidence", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Foreign evidence",
        level: 1,
        reason: "doctor contract",
      });
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Done",
          evidence: [
            { type: "validation", reference: "ref://test", summary: "Pass" },
          ],
          record: {
            summary: "Recorded",
            specImpact: { outcome: "none", reason: "No reusable rule" },
          },
        },
      });
      database.exec("DROP TRIGGER spec_impact_results_immutable_update");
      database
        .prepare(
          `UPDATE spec_impact_results SET outcome = 'updated', details_json = ?`,
        )
        .run(
          JSON.stringify({
            updates: [
              {
                specId: "engineering.delivery",
                path: "docs/delivery.md",
                evidenceRefs: ["ev-foreign"],
              },
            ],
          }),
        );

      const check = checkOf(database, "spec-impact");
      expect(check.ok).toBe(false);
      expect(check.error?.problem).toContain("foreign evidence");
    } finally {
      database.close();
    }
  });

  it("flags an incomplete inherited L3 binding set", () => {
    const database = createMigratedDatabase();
    try {
      const spec = {
        specId: "engineering.delivery",
        kind: "engineering" as const,
        path: "docs/delivery.md",
        duty: "required" as const,
      };
      const plan = {
        ...L3_PLAN_RESULT,
        modules: L3_PLAN_RESULT.modules.map((module, index) => ({
          ...module,
          specBindings:
            index === 0 ? [{ id: spec.specId, duty: spec.duty }] : [],
        })),
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
          { type: "validation", reference: "ref://review", summary: "Pass" },
        ],
        acceptedPlanSpecBindings: {
          execution: [],
          modules: { contract: [spec], projection: [] },
        },
      });
      database.exec("DROP TRIGGER lifecycle_spec_bindings_immutable_delete");
      database
        .prepare(
          `DELETE FROM lifecycle_spec_bindings
           WHERE task_id = 'T-2' AND node_id = 'record-1'`,
        )
        .run();

      const check = checkOf(database, "spec-bindings");
      expect(check.ok).toBe(false);
      expect(check.error?.problem).toContain(
        "engineering.delivery is not bound to every delivery node",
      );
    } finally {
      database.close();
    }
  });

  it("flags inherited L3 provenance that points at the wrong parent attempt", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(database);
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
          { type: "validation", reference: "ref://review", summary: "Pass" },
        ],
        acceptedPlanSpecBindings: {
          execution: [],
          modules: { contract: [], projection: [] },
        },
      });
      database.exec(
        "DROP TRIGGER lifecycle_inherited_planning_immutable_update",
      );
      database
        .prepare(
          `UPDATE lifecycle_inherited_planning
           SET source_plan_attempt_id = ? WHERE child_task_id = 'T-2'`,
        )
        .run(`att-${taskId}-frame-1-1`);

      const check = checkOf(database, "l3-relations");
      expect(check.ok).toBe(false);
      expect(check.error?.problem).toContain(
        "inexact inherited Plan provenance",
      );
    } finally {
      database.close();
    }
  });
});

function checkOf(database: TaskcraftDatabase, name: string): DoctorCheck {
  const check = runDoctorChecks(database, MIGRATIONS_DIRECTORY).find(
    (candidate) => candidate.name === name,
  );
  expect(check, `check ${name}`).toBeDefined();
  return check!;
}
