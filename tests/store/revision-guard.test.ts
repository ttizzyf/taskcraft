import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { checkRevision } from "../../src/store/revision-guard.js";
import { withTransaction } from "../../src/store/transaction.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
  insertTask,
} from "./helpers.js";

describe("checkRevision", () => {
  it("returns the task snapshot when the revision matches", () => {
    const database = createMigratedDatabase();

    try {
      insertTask(database, {
        id: "task-1",
        title: "Build store layer",
        level: 1,
      });

      const snapshot = checkRevision(database, "task-1", 1);

      expect(snapshot.id).toBe("task-1");
      expect(snapshot.title).toBe("Build store layer");
      expect(snapshot.level).toBe(1);
      expect(snapshot.revision).toBe(1);
      expect(snapshot.currentLifecycleRevision).toBe(1);
      expect(snapshot.objectiveMd).toBe("Objective");
      expect(snapshot.scopeJson).toBe("{}");
      expect(snapshot.acceptanceJson).toBe("[]");
      expect(snapshot.nonGoalsJson).toBe("[]");
      expect(snapshot.classificationFactsJson).toBe("{}");
      expect(snapshot.classificationReasonsJson).toBe("[]");
      expect(snapshot.parentTaskId).toBeNull();
      expect(snapshot.activatedAt).toBeNull();
      expect(snapshot.cancelledAt).toBeNull();
      expect(snapshot.cancelReason).toBeNull();
      expect(snapshot.createdAt).toBe("2026-08-11T00:00:00.000Z");
    } finally {
      database.close();
    }
  });

  it("throws TC_TASK_NOT_FOUND for an unknown task", () => {
    const database = createMigratedDatabase();

    try {
      const error = captureTaskcraftError(() =>
        checkRevision(database, "task-missing", 1),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_NOT_FOUND);
      expect(error.remediation).toContain("tc task list");
    } finally {
      database.close();
    }
  });

  it("throws TC_REVISION_CONFLICT with the current revision and a re-read command", () => {
    const database = createMigratedDatabase();

    try {
      insertTask(database, { id: "task-1" });
      database
        .prepare("UPDATE tasks SET revision = 2, updated_at = ? WHERE id = ?")
        .run("2026-08-11T01:00:00.000Z", "task-1");

      const error = captureTaskcraftError(() =>
        checkRevision(database, "task-1", 1),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVISION_CONFLICT);
      expect(error.context).toEqual({
        taskId: "task-1",
        expectedRevision: 1,
        currentRevision: 2,
      });
      expect(error.problem).toContain("expected 1, current is 2");
      expect(error.remediation).toContain("tc status --json");
    } finally {
      database.close();
    }
  });

  it("composes with withTransaction for CAS-then-write flows", () => {
    const database = createMigratedDatabase();

    try {
      insertTask(database, { id: "task-1" });

      withTransaction(database, () => {
        const snapshot = checkRevision(database, "task-1", 1);

        database
          .prepare(
            "UPDATE tasks SET activated_at = ?, updated_at = ? WHERE id = ?",
          )
          .run(
            "2026-08-11T02:00:00.000Z",
            "2026-08-11T02:00:00.000Z",
            snapshot.id,
          );
      });

      expect(checkRevision(database, "task-1", 1).activatedAt).toBe(
        "2026-08-11T02:00:00.000Z",
      );
    } finally {
      database.close();
    }
  });
});
