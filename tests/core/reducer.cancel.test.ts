import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { cancel, run, taskNew } from "../../src/core/reducer.js";
import { getAttempts, getTask } from "../../src/store/query.js";
import { loadFixtureFile } from "../helpers/load-fixture.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import { queryEvents } from "./reducer-utils.js";

describe("reducer cancel", () => {
  it("writes cancellation facts and terminates the active attempt", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Cancel me",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);

      const result = cancel(database, taskId, { reason: "superseded" });

      expect(result.status).toBe("cancelled");
      expect(result.next).toBe(`tc task show ${taskId}`);

      const task = getTask(database, taskId)!;
      expect(task.cancelledAt).not.toBeNull();
      expect(task.cancelReason).toBe("superseded");
      expect(task.revision).toBe(3);

      expect(getAttempts(database, taskId)).toEqual([
        expect.objectContaining({ status: "cancelled", outcome: "abandoned" }),
      ]);
      expect(
        queryEvents(database, taskId).map((event) => event.eventType),
      ).toEqual(["task.created", "task.activated", "task.cancelled"]);
    } finally {
      database.close();
    }
  });

  it("rejects a second cancel with TC_TASK_ALREADY_CANCELLED", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "cancel");

      const error = captureTaskcraftError(() =>
        cancel(database, "T-106", { reason: "again" }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_ALREADY_CANCELLED);
      expect(getTask(database, "T-106")!.revision).toBe(3);
    } finally {
      database.close();
    }
  });

  it("cancels a task that never ran", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Never ran",
        level: 1,
        reason: "reason",
      }).taskId;

      const result = cancel(database, taskId, { reason: "no longer needed" });

      expect(result.status).toBe("cancelled");
      expect(getTask(database, taskId)!.cancelledAt).not.toBeNull();
      expect(getAttempts(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});

describe("reducer CAS guard", () => {
  it("rejects writes against a stale expectedRevision with TC_REVISION_CONFLICT", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "revision-conflict");

      const error = captureTaskcraftError(() =>
        run(database, "T-104", { expectedRevision: 1 }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVISION_CONFLICT);
      expect(error.context).toMatchObject({
        taskId: "T-104",
        expectedRevision: 1,
        currentRevision: 2,
      });
      expect(getTask(database, "T-104")!.revision).toBe(2);
    } finally {
      database.close();
    }
  });
});
