import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { run, runComplete, taskNew } from "../../src/core/reducer.js";
import {
  getAttempts,
  getLastEventSeq,
  getTask,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import { countAttempts, queryEvents, VALID_RESULT } from "./reducer-utils.js";

describe("reducer run", () => {
  it("delivers exact revision-bound Spec snapshots in the Node Brief", () => {
    const database = createMigratedDatabase();
    try {
      const taskId = taskNew(database, {
        title: "Bound delivery",
        level: 1,
        reason: "exact contract",
        initialSpecBindings: [
          {
            specId: "engineering.delivery",
            kind: "engineering",
            path: "docs/delivery.md",
            duty: "required",
          },
          {
            specId: "domain.approval",
            kind: "domain",
            path: "docs/approval.md",
            duty: "recommended",
          },
        ],
      }).taskId;

      const result = run(database, taskId);

      expect(result.nodeBrief).toMatchObject({
        taskRevision: 2,
        lifecycleRevision: 1,
      });
      expect(result.nodeBrief!.specs).toEqual([
        {
          id: "domain.approval",
          kind: "domain",
          path: "docs/approval.md",
          duty: "recommended",
        },
        {
          id: "engineering.delivery",
          kind: "engineering",
          path: "docs/delivery.md",
          duty: "required",
        },
      ]);
      expect(result.nodeBrief!.reviewContext).toBeNull();
    } finally {
      database.close();
    }
  });

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

  it("rejects a blocked node with TC_ATTEMPT_REF_INVALID", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Node check",
        level: 1,
        reason: "reason",
      }).taskId;

      // record-1 is blocked until execute-1 is satisfied.
      const error = captureTaskcraftError(() =>
        run(database, taskId, { nodeId: "record-1" }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(countAttempts(database)).toBe(0);
    } finally {
      database.close();
    }
  });

  it("claims record-1 once execute-1 is satisfied", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Record claim",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Done",
          evidence: [{ type: "validation", reference: "r", summary: "ok" }],
        },
      });

      const result = run(database, taskId, { nodeId: "record-1" });

      expect(result.nodeBrief).toMatchObject({
        taskId,
        nodeId: "record-1",
        nodeKind: "record",
        nextCommand: `tc run complete ${taskId} --node record-1`,
      });
      expect(
        result.nodeBrief!.obligations.map((obligation) => obligation.id),
      ).toEqual(["result-and-scope-retained", "spec-impact-recorded"]);
      expect(JSON.parse(result.nodeBrief!.resultSchemaJson).required).toEqual([
        "summary",
        "specImpact",
      ]);
      expect(getAttempts(database, taskId)).toContainEqual(
        expect.objectContaining({
          nodeId: "record-1",
          attemptNumber: 1,
          status: "created",
        }),
      );
    } finally {
      database.close();
    }
  });

  it("rejects claiming an already satisfied node", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Satisfied node",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);
      runComplete(database, taskId, { result: VALID_RESULT });

      const error = captureTaskcraftError(() =>
        run(database, taskId, { nodeId: "execute-1" }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(
        getAttempts(database, taskId).filter(
          (attempt) => attempt.nodeId === "execute-1",
        ),
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
