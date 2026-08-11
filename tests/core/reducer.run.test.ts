import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { run, taskNew } from "../../src/core/reducer.js";
import {
  getAttempts,
  getLastEventSeq,
  getTask,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import { countAttempts, queryEvents } from "./reducer-utils.js";

describe("reducer run", () => {
  it("activates a queued task and claims the execute-1 attempt", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Run me",
        level: 1,
        reason: "reason",
      }).taskId;

      const result = run(database, taskId, { host: "codex" });

      expect(result.status).toBe("active");
      expect(result.next).toBe(`tc run complete ${taskId}`);
      expect(result.nodeBrief).toMatchObject({
        taskId,
        nodeId: "execute-1",
        nodeKind: "execute",
        objective: "Run me",
        nextCommand: `tc run complete ${taskId}`,
      });
      expect(
        result.nodeBrief!.obligations.map((obligation) => obligation.id),
      ).toEqual(["minimum-validation-recorded", "requested-outcome-produced"]);
      expect(JSON.parse(result.nodeBrief!.resultSchemaJson).required).toEqual([
        "summary",
        "evidence",
      ]);

      const task = getTask(database, taskId)!;
      expect(task.activatedAt).not.toBeNull();
      expect(task.revision).toBe(2);

      expect(getAttempts(database, taskId)).toEqual([
        expect.objectContaining({
          id: `att-${taskId}-execute-1-1`,
          nodeId: "execute-1",
          attemptNumber: 1,
          status: "created",
          actorInstanceId: "cli",
          host: "codex",
        }),
      ]);
      expect(
        queryEvents(database, taskId).map((event) => event.eventType),
      ).toEqual(["task.created", "task.activated"]);
      expect(getLastEventSeq(database, taskId)).toBe(2);
    } finally {
      database.close();
    }
  });

  it("returns the existing attempt without writing when run is repeated", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Repeat run",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);

      const firstAttempt = getAttempts(database, taskId)[0]!.id;
      const result = run(database, taskId);

      expect(result.nodeBrief!.attemptId).toBe(firstAttempt);
      expect(getTask(database, taskId)!.revision).toBe(2);
      expect(queryEvents(database, taskId)).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("creates a successor attempt when the activated task has no active attempt", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Successor",
        level: 1,
        reason: "reason",
      }).taskId;
      const first = run(database, taskId);
      const second = run(database, taskId);
      expect(second.nodeBrief!.attemptId).toBe(first.nodeBrief!.attemptId);

      // Close the first attempt as failed, then run again claims attempt 2.
      database
        .prepare(
          `UPDATE node_attempts SET status = 'failed', outcome = 'failed',
                  finished_at = ? WHERE id = ?`,
        )
        .run("2026-08-11T00:00:00.000Z", first.nodeBrief!.attemptId);

      const third = run(database, taskId);

      expect(third.nodeBrief!.attemptId).toBe(`att-${taskId}-execute-1-2`);
      expect(
        getAttempts(database, taskId).map((attempt) => attempt.attemptNumber),
      ).toEqual([1, 2]);
    } finally {
      database.close();
    }
  });

  it("rejects a non-execute node with TC_ATTEMPT_REF_INVALID", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Node check",
        level: 1,
        reason: "reason",
      }).taskId;

      const error = captureTaskcraftError(() =>
        run(database, taskId, { nodeId: "record-1" }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(countAttempts(database)).toBe(0);
    } finally {
      database.close();
    }
  });
});
