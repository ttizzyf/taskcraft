import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { LEGACY_L1_EXECUTE_RESULT_SCHEMA } from "../../src/core/lifecycle/l1.js";
import {
  reviewStart,
  run,
  runComplete,
  taskNew,
} from "../../src/core/reducer.js";
import {
  storedNodeResultIssues,
  validateStoredNodeResult,
} from "../../src/core/reducer/lifecycle-result.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import {
  completeModuleChildren,
  passReview,
  reviewInput,
  setupL3ToFeasibility,
} from "./l3-utils.js";

describe("stored node result diagnostics", () => {
  it("reports nested paths, missing and additional fields without submitted values or writes", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId } = taskNew(db, {
        title: "Diagnostics",
        level: 1,
        reason: "local",
      });
      run(db, taskId);
      const bytes = db.serialize();
      const result = {
        summary: 42,
        evidence: [{ type: "test", summary: "secret-evidence-value" }],
        unexpected: "secret-extra-value",
      };
      const error = captureTaskcraftError(() =>
        runComplete(db, taskId, { result }),
      );
      expect(error.code).toBe(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID);
      expect(error.problem).toContain("/summary [type]: must be string");
      expect(error.problem).toContain("/evidence/0/reference [required]");
      expect(error.problem).toContain("/unexpected [additionalProperties]");
      expect(error.problem).not.toContain("secret-evidence-value");
      expect(error.problem).not.toContain("secret-extra-value");
      expect(error.remediation).toContain(`tc task show ${taskId} --json`);
      expect(db.serialize()).toEqual(bytes);
    } finally {
      db.close();
    }
  });

  it.each([
    [1, "execute-1", "/summary [required]"],
    [2, "frame-1", "/objective [required]"],
    [3, "plan-1", "/decomposition [required]"],
    [1, "record-1", "/specImpact [required]"],
  ] as const)(
    "uses the shared diagnostic for L%i %s",
    (level, nodeId, expected) => {
      const db = createMigratedDatabase();
      try {
        const { taskId } = taskNew(db, {
          title: "Node contract",
          level,
          reason: "schema",
        });
        const bytes = db.serialize();
        const error = captureTaskcraftError(() =>
          runComplete(db, taskId, { nodeId, result: {} }),
        );
        expect(error.problem).toContain(expected);
        expect(error.remediation).toContain(`tc task show ${taskId} --json`);
        expect(db.serialize()).toEqual(bytes);
      } finally {
        db.close();
      }
    },
  );

  it("validates Integrate against its stored schema and keeps failures read-only", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(db);
      const review = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      passReview(db, taskId, review.reviewAttemptId, planAttemptId);
      completeModuleChildren(db, taskId);
      run(db, taskId, { nodeId: "integrate-1" });
      const bytes = db.serialize();
      const error = captureTaskcraftError(() =>
        runComplete(db, taskId, {
          nodeId: "integrate-1",
          result: { childrenResults: [], integrationEvidence: "not-an-array" },
        }),
      );
      expect(error.problem).toContain(
        "/integrationEvidence [type]: must be array",
      );
      expect(error.remediation).toContain(`tc task show ${taskId} --json`);
      expect(db.serialize()).toEqual(bytes);
    } finally {
      db.close();
    }
  });

  it("uses historical schema bytes independently of the current compiler and shared validator cache", () => {
    const db = createMigratedDatabase();
    try {
      const old = taskNew(db, {
        title: "Old schema",
        level: 1,
        reason: "history",
      }).taskId;
      const current = taskNew(db, {
        title: "Current schema",
        level: 1,
        reason: "current",
      }).taskId;
      db.exec("DROP TRIGGER lifecycle_nodes_immutable_update");
      db.prepare(
        "UPDATE lifecycle_nodes SET output_schema_json = ? WHERE task_id = ? AND id = 'execute-1'",
      ).run(JSON.stringify(LEGACY_L1_EXECUTE_RESULT_SCHEMA), old);
      const result = {
        summary: "done",
        evidence: [],
        record: { summary: "Legacy record without Spec Impact" },
      };
      const bytes = db.serialize();
      expect(storedNodeResultIssues(db, old, 1, "execute-1", result)).toEqual(
        [],
      );
      expect(validateStoredNodeResult(db, old, 1, "execute-1", result)).toBe(
        true,
      );
      expect(
        storedNodeResultIssues(db, current, 1, "execute-1", result).join(";"),
      ).toContain("/record/specImpact [required]");
      expect(
        validateStoredNodeResult(db, current, 1, "execute-1", result),
      ).toBe(false);
      expect(storedNodeResultIssues(db, old, 1, "execute-1", result)).toEqual(
        [],
      );
      expect(db.serialize()).toEqual(bytes);
    } finally {
      db.close();
    }
  });
});
