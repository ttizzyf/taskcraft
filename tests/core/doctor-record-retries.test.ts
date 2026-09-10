import { describe, expect, it } from "vitest";

import { checkSpecImpact } from "../../src/core/doctor-spec-impact.js";
import {
  reviewChanges,
  reviewPass,
  reviewStart,
  run,
  runComplete,
  taskNew,
} from "../../src/core/reducer.js";
import type { TaskcraftDatabase } from "../../src/store/database.js";
import { getSpecImpactResults } from "../../src/store/query.js";
import { createMigratedDatabase } from "../store/helpers.js";
import {
  L2_FRAME_RESULT,
  reviewStartInput,
  VALID_RESULT,
} from "./reducer-utils.js";

function completeRepeatedRecords(db: TaskcraftDatabase): string {
  const { taskId } = taskNew(db, {
    title: "Reviewed correction",
    level: 2,
    reason: "independent review",
  });
  run(db, taskId, { nodeId: "frame-1" });
  runComplete(db, taskId, { nodeId: "frame-1", result: L2_FRAME_RESULT });
  run(db, taskId);
  runComplete(db, taskId, { result: VALID_RESULT });
  const firstExecute = `att-${taskId}-execute-1-1`;
  const firstReview = reviewStart(
    db,
    taskId,
    reviewStartInput(taskId, firstExecute),
  );
  reviewChanges(db, taskId, {
    taskId,
    attemptId: firstReview.reviewAttemptId,
    reviewedAttemptId: firstExecute,
    finding: "Fix boundary",
  });
  runComplete(db, taskId, {
    result: {
      ...VALID_RESULT,
      record: { ...VALID_RESULT.record, summary: "Correction recorded" },
    },
  });
  const secondExecute = `att-${taskId}-execute-1-2`;
  const secondReview = reviewStart(
    db,
    taskId,
    reviewStartInput(taskId, secondExecute),
  );
  const completed = reviewPass(db, taskId, {
    taskId,
    attemptId: secondReview.reviewAttemptId,
    reviewedAttemptId: secondExecute,
    evidence: [
      {
        type: "validation",
        reference: "test://second-review",
        summary: "Correction verified",
      },
    ],
  });
  expect(completed.status).toBe("done");
  return taskId;
}

describe("doctor Record retry obligation ownership", () => {
  it("accepts two successful Records with individual Impacts and one node-level satisfied obligation", () => {
    const db = createMigratedDatabase();
    try {
      const taskId = completeRepeatedRecords(db);
      expect(
        getSpecImpactResults(db, taskId).map((row) => row.recordAttemptId),
      ).toEqual([`att-${taskId}-record-1-1`, `att-${taskId}-record-1-2`]);
      expect(
        db
          .prepare(
            "SELECT satisfied_by_evidence_id AS evidenceId FROM obligation_results WHERE task_id = ? AND obligation_id = 'spec-impact-recorded'",
          )
          .all(taskId),
      ).toEqual([{ evidenceId: `ev-${taskId}-att-${taskId}-record-1-1-1` }]);
      const bytes = db.serialize();
      expect(checkSpecImpact(db)).toEqual({ name: "spec-impact", ok: true });
      expect(db.serialize()).toEqual(bytes);
    } finally {
      db.close();
    }
  });

  it.each([
    "missing",
    "foreign-owner",
    "wrong-node",
    "wrong-revision",
    "failed-record",
    "missing-referenced-impact",
    "missing-second-impact",
  ] as const)("rejects %s without altering damaged facts", (damage) => {
    const db = createMigratedDatabase();
    try {
      const taskId = completeRepeatedRecords(db);
      // Explicit corruption fixture: bypass only constraints needed to model
      // damaged facts that doctor must still diagnose read-only.
      db.exec("DROP TRIGGER obligation_results_evidence_owner_update");
      if (damage === "missing") {
        db.prepare(
          "DELETE FROM obligation_results WHERE task_id = ? AND obligation_id = 'spec-impact-recorded'",
        ).run(taskId);
      } else if (damage === "foreign-owner" || damage === "wrong-node") {
        let evidenceId = `ev-${taskId}-att-${taskId}-execute-1-1-1`;
        if (damage === "foreign-owner") {
          const foreign = taskNew(db, {
            title: "Other task",
            level: 1,
            reason: "owner fixture",
          }).taskId;
          run(db, foreign);
          runComplete(db, foreign, { result: VALID_RESULT });
          evidenceId = `ev-${foreign}-att-${foreign}-record-1-1-1`;
          db.pragma("foreign_keys = OFF");
        }
        db.prepare(
          "UPDATE obligation_results SET satisfied_by_evidence_id = ? WHERE task_id = ? AND obligation_id = 'spec-impact-recorded'",
        ).run(evidenceId, taskId);
      } else if (damage === "wrong-revision") {
        db.pragma("foreign_keys = OFF");
        db.prepare(
          "UPDATE obligation_results SET lifecycle_revision = 2 WHERE task_id = ? AND obligation_id = 'spec-impact-recorded'",
        ).run(taskId);
      } else if (damage === "failed-record") {
        db.prepare(
          "UPDATE node_attempts SET status = 'failed', outcome = 'failed' WHERE id = ?",
        ).run(`att-${taskId}-record-1-1`);
      } else {
        db.exec("DROP TRIGGER spec_impact_results_immutable_delete");
        const number = damage === "missing-second-impact" ? 2 : 1;
        db.prepare(
          "DELETE FROM spec_impact_results WHERE record_attempt_id = ?",
        ).run(`att-${taskId}-record-1-${number}`);
      }
      const bytes = db.serialize();
      const check = checkSpecImpact(db);
      expect(check.ok).toBe(false);
      expect(check.error?.code).toBe("TC_SPEC_IMPACT_INVALID");
      expect(check.error?.problem).toContain(
        damage === "missing-second-impact"
          ? "missing Spec Impact"
          : "missing satisfied Spec Impact obligation result",
      );
      if (
        [
          "foreign-owner",
          "wrong-node",
          "wrong-revision",
          "failed-record",
          "missing-referenced-impact",
        ].includes(damage)
      ) {
        expect(check.error?.problem).toContain(
          "orphan Spec Impact obligation result",
        );
      }
      expect(db.serialize()).toEqual(bytes);
    } finally {
      db.close();
    }
  });
});
