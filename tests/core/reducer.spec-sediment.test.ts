import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { project } from "../../src/core/projector.js";
import {
  run,
  runComplete,
  specSediment,
  taskNew,
} from "../../src/core/reducer.js";
import type { TaskcraftDatabase } from "../../src/store/database.js";
import {
  getObligationResults,
  getSpecSedimentationResults,
  getTask,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import { VALID_RESULT, countEvents } from "./reducer-utils.js";

/** Drives an L1 task to `done` through the normal graph. */
function doneTask(database: TaskcraftDatabase): string {
  const { taskId } = taskNew(database, {
    title: "Sediment source task",
    level: 1,
    reason: "reason",
  });
  run(database, taskId, {});
  runComplete(database, taskId, { result: VALID_RESULT });

  return taskId;
}

describe("Spec sedimentation reducer contract", () => {
  it("records a fact for a done task without creating obligations or leaving done", () => {
    const database = createMigratedDatabase();
    try {
      const taskId = doneTask(database);
      const revisionBefore = getTask(database, taskId)!.revision;
      const obligationsBefore = countObligations(database, taskId);
      const resultsBefore = getObligationResults(database, taskId).length;
      const eventsBefore = countEvents(database);

      const result = specSediment(database, taskId, {
        reason: "Capture the rule for later tasks",
        specIds: ["engineering.probe"],
      });

      expect(result.inserted).toBe(true);
      expect(result.status).toBe("done");
      expect(project(database, taskId).status).toBe("done");
      expect(getSpecSedimentationResults(database, taskId)).toHaveLength(1);
      expect(countObligations(database, taskId)).toBe(obligationsBefore);
      expect(getObligationResults(database, taskId)).toHaveLength(
        resultsBefore,
      );
      expect(getTask(database, taskId)!.revision).toBe(revisionBefore + 1);
      expect(countEvents(database)).toBe(eventsBefore + 1);
    } finally {
      database.close();
    }
  });

  it("records the touched Spec ids in canonical order and nothing else", () => {
    const database = createMigratedDatabase();
    try {
      const taskId = doneTask(database);

      const result = specSediment(database, taskId, {
        reason: "Capture the rule",
        specIds: ["engineering.zulu", "engineering.alpha"],
      });

      expect(result.specIds).toEqual(["engineering.alpha", "engineering.zulu"]);
      expect(getSpecSedimentationResults(database, taskId)[0]).toEqual({
        taskId,
        lifecycleRevision: 1,
        specIdsJson: JSON.stringify(["engineering.alpha", "engineering.zulu"]),
        reason: "Capture the rule",
        createdBy: "cli",
        createdAt: expect.any(String) as unknown as string,
      });
    } finally {
      database.close();
    }
  });

  it("refuses to sediment a task that has not reached done", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Still running",
        level: 1,
        reason: "reason",
      });

      const error = captureTaskcraftError(() =>
        specSediment(database, taskId, {
          reason: "Capture the rule",
          specIds: ["engineering.probe"],
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_SPEC_SEDIMENTATION_INVALID);
      expect(error.problem).toContain("done");
      expect(getSpecSedimentationResults(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("treats a replay of the same Spec list as a no-op without bumping the revision", () => {
    const database = createMigratedDatabase();
    try {
      const taskId = doneTask(database);
      specSediment(database, taskId, {
        reason: "Capture the rule",
        specIds: ["engineering.alpha", "engineering.zulu"],
      });
      const revisionAfterFirst = getTask(database, taskId)!.revision;
      const eventsAfterFirst = countEvents(database);

      // A different order is the same list: the stored key is canonical.
      const replay = specSediment(database, taskId, {
        reason: "Capture the rule again",
        specIds: ["engineering.zulu", "engineering.alpha"],
      });

      expect(replay.inserted).toBe(false);
      expect(getSpecSedimentationResults(database, taskId)).toHaveLength(1);
      expect(getTask(database, taskId)!.revision).toBe(revisionAfterFirst);
      expect(countEvents(database)).toBe(eventsAfterFirst);
    } finally {
      database.close();
    }
  });

  it("appends a new row when the Spec list differs", () => {
    const database = createMigratedDatabase();
    try {
      const taskId = doneTask(database);
      specSediment(database, taskId, {
        reason: "Capture the rule",
        specIds: ["engineering.alpha"],
      });
      specSediment(database, taskId, {
        reason: "Capture a second rule",
        specIds: ["engineering.alpha", "engineering.beta"],
      });

      const rows = getSpecSedimentationResults(database, taskId);

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.specIdsJson)).toEqual([
        JSON.stringify(["engineering.alpha"]),
        JSON.stringify(["engineering.alpha", "engineering.beta"]),
      ]);
    } finally {
      database.close();
    }
  });

  it("rejects a blank reason, an empty list and a repeated id without writing facts", () => {
    const database = createMigratedDatabase();
    try {
      const taskId = doneTask(database);
      const revisionBefore = getTask(database, taskId)!.revision;

      const blankReason = captureTaskcraftError(() =>
        specSediment(database, taskId, {
          reason: "   ",
          specIds: ["engineering.probe"],
        }),
      );
      const emptyList = captureTaskcraftError(() =>
        specSediment(database, taskId, {
          reason: "Capture the rule",
          specIds: [],
        }),
      );
      const repeated = captureTaskcraftError(() =>
        specSediment(database, taskId, {
          reason: "Capture the rule",
          specIds: ["engineering.probe", "engineering.probe"],
        }),
      );

      for (const error of [blankReason, emptyList, repeated]) {
        expect(error.code).toBe(ERROR_CODES.TC_SPEC_SEDIMENTATION_INVALID);
      }
      expect(getSpecSedimentationResults(database, taskId)).toHaveLength(0);
      expect(getTask(database, taskId)!.revision).toBe(revisionBefore);
    } finally {
      database.close();
    }
  });

  it("rolls back the whole command when the fact cannot be inserted", () => {
    const database = createMigratedDatabase();
    try {
      const taskId = doneTask(database);
      const revisionBefore = getTask(database, taskId)!.revision;
      const eventsBefore = countEvents(database);
      database.exec(
        `CREATE TRIGGER test_abort_sedimentation
         BEFORE INSERT ON spec_sedimentation_results
         BEGIN SELECT RAISE(ABORT, 'forced sedimentation failure'); END;`,
      );

      const error = captureTaskcraftError(() =>
        specSediment(database, taskId, {
          reason: "Capture the rule",
          specIds: ["engineering.probe"],
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_STORE_TRANSACTION_FAILED);
      expect(getSpecSedimentationResults(database, taskId)).toHaveLength(0);
      expect(getTask(database, taskId)!.revision).toBe(revisionBefore);
      expect(countEvents(database)).toBe(eventsBefore);
    } finally {
      database.close();
    }
  });

  it("rejects a stale expected revision without writing facts", () => {
    const database = createMigratedDatabase();
    try {
      const taskId = doneTask(database);

      const error = captureTaskcraftError(() =>
        specSediment(database, taskId, {
          reason: "Capture the rule",
          specIds: ["engineering.probe"],
          expectedRevision: 999,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVISION_CONFLICT);
      expect(getSpecSedimentationResults(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});

function countObligations(database: TaskcraftDatabase, taskId: string): number {
  return (
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM obligation_definitions WHERE task_id = ?",
      )
      .get(taskId) as { count: number }
  ).count;
}
