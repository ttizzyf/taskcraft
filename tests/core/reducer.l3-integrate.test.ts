import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { reviewStart, run, runComplete } from "../../src/core/reducer.js";
import { getAttempts } from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import {
  completeModuleChildren,
  integrateResult,
  passReview,
  reviewInput,
  setupL3ToFeasibility,
} from "./l3-utils.js";

describe("L3 integration references", () => {
  it("rejects duplicate child references even when every required child is present", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(db);
      const feasibility = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      passReview(db, taskId, feasibility.reviewAttemptId, planAttemptId);
      const childTaskIds = completeModuleChildren(db, taskId);
      const valid = integrateResult(db, childTaskIds, false);
      run(db, taskId, { nodeId: "integrate-1" });

      const error = captureTaskcraftError(() =>
        runComplete(db, taskId, {
          nodeId: "integrate-1",
          result: {
            ...valid,
            childrenResults: [
              ...valid.childrenResults,
              { ...valid.childrenResults[0]! },
            ],
          },
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID);
      expect(error.problem).toContain("exactly once");
      expect(
        getAttempts(db, taskId).find(
          (attempt) => attempt.id === `att-${taskId}-integrate-1-1`,
        ),
      ).toMatchObject({ status: "created", outcome: null });
    } finally {
      db.close();
    }
  });
});
