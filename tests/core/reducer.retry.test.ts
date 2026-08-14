import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { project } from "../../src/core/projector.js";
import {
  run,
  runComplete,
  runFail,
  runRetry,
  taskNew,
  taskWait,
} from "../../src/core/reducer.js";
import {
  getAttempts,
  getOpenBlockers,
  getTask,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import { queryEvents } from "./reducer-utils.js";

function failOnce(
  database: ReturnType<typeof createMigratedDatabase>,
  taskId: string,
  index: number,
): void {
  const runResult = run(database, taskId);
  runFail(database, taskId, {
    attemptId: runResult.nodeBrief!.attemptId,
    reason: `failure ${index}`,
  });
}

/** Inserts failed execute-1 attempts directly (fixture-style state setup
 * for budget edge cases), numbering from `from` to `to` inclusive. */
function insertFailedAttempts(
  database: ReturnType<typeof createMigratedDatabase>,
  taskId: string,
  from: number,
  to: number,
  now = "2026-08-11T00:00:00.000Z",
): void {
  const insert = database.prepare(
    `INSERT INTO node_attempts (
       id, task_id, lifecycle_revision, node_id, attempt_number,
       actor_instance_id, host, status, outcome, result_json, started_at,
       finished_at
     ) VALUES (?, ?, 1, 'execute-1', ?, 'actor-1', 'host-1',
       'failed', 'failed', NULL, ?, ?)`,
  );

  for (let attempt = from; attempt <= to; attempt += 1) {
    insert.run(`att-${taskId}-execute-1-${attempt}`, taskId, attempt, now, now);
  }
}

describe("reducer runFail", () => {
  it("marks the attempt failed with finished_at and appends attempt.failed", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Fail once",
        level: 1,
        reason: "reason",
      }).taskId;
      const runResult = run(database, taskId);

      const result = runFail(database, taskId, {
        attemptId: runResult.nodeBrief!.attemptId,
        reason: "probe failed",
      });

      expect(result.status).toBe("active");
      expect(getAttempts(database, taskId)).toEqual([
        expect.objectContaining({
          status: "failed",
          outcome: "failed",
          finishedAt: expect.any(String),
        }),
      ]);
      expect(
        queryEvents(database, taskId).map((event) => event.eventType),
      ).toEqual(["task.created", "task.activated", "attempt.failed"]);
    } finally {
      database.close();
    }
  });

  it("rejects a finished attempt with TC_ATTEMPT_REF_INVALID and writes nothing", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Already done",
        level: 1,
        reason: "reason",
      }).taskId;
      const runResult = run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "done",
          evidence: [{ type: "validation", reference: "r", summary: "ok" }],
        },
      });

      const error = captureTaskcraftError(() =>
        runFail(database, taskId, {
          attemptId: runResult.nodeBrief!.attemptId,
          reason: "too late",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(getTask(database, taskId)!.revision).toBe(3);
      expect(queryEvents(database, taskId)).toHaveLength(3);
    } finally {
      database.close();
    }
  });

  it("opens the failed_retries_exhausted blocker on the third consecutive failure", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Fail thrice",
        level: 1,
        reason: "reason",
      }).taskId;

      for (let index = 1; index <= 2; index += 1) {
        failOnce(database, taskId, index);
      }

      expect(getOpenBlockers(database, taskId)).toHaveLength(0);

      failOnce(database, taskId, 3);

      const projection = project(database, taskId);
      expect(projection.status).toBe("waiting");
      expect(projection.waitingReason).toBe("failed_retries_exhausted");
      expect(projection.next).toBe(`tc task resume ${taskId} --resolve`);
      expect(getOpenBlockers(database, taskId)[0]).toMatchObject({
        kind: "evidence",
        waitingReason: "failed_retries_exhausted",
        status: "open",
      });
    } finally {
      database.close();
    }
  });

  it("rejects a stale expected revision with TC_REVISION_CONFLICT", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "CAS fail",
        level: 1,
        reason: "reason",
      }).taskId;
      const runResult = run(database, taskId);

      const error = captureTaskcraftError(() =>
        runFail(database, taskId, {
          attemptId: runResult.nodeBrief!.attemptId,
          reason: "stale",
          expectedRevision: 1,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVISION_CONFLICT);
      expect(getAttempts(database, taskId)[0]).toMatchObject({
        status: "created",
      });
    } finally {
      database.close();
    }
  });
});

describe("reducer runRetry", () => {
  it("creates a successor attempt numbered after the failed one and keeps it failed", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Retry me",
        level: 1,
        reason: "reason",
      }).taskId;
      const runResult = run(database, taskId);
      runFail(database, taskId, {
        attemptId: runResult.nodeBrief!.attemptId,
        reason: "host died",
      });

      const result = runRetry(database, taskId, {
        attemptId: runResult.nodeBrief!.attemptId,
        reason: "host came back",
      });

      expect(result.status).toBe("active");
      expect(result.successorAttemptId).toBe(`att-${taskId}-execute-1-2`);
      expect(result.nodeBrief).toMatchObject({
        taskId,
        nodeId: "execute-1",
        attemptId: `att-${taskId}-execute-1-2`,
        nextCommand: `tc run complete ${taskId}`,
      });
      expect(getAttempts(database, taskId)).toEqual([
        expect.objectContaining({ attemptNumber: 1, status: "failed" }),
        expect.objectContaining({
          attemptNumber: 2,
          status: "created",
          outcome: null,
        }),
      ]);
      expect(
        queryEvents(database, taskId).map((event) => event.eventType),
      ).toEqual([
        "task.created",
        "task.activated",
        "attempt.failed",
        "attempt.retried",
      ]);
    } finally {
      database.close();
    }
  });

  it("rejects a created attempt without a stale observation", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Still running",
        level: 1,
        reason: "reason",
      }).taskId;
      const runResult = run(database, taskId);

      const error = captureTaskcraftError(() =>
        runRetry(database, taskId, {
          attemptId: runResult.nodeBrief!.attemptId,
          reason: "why",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(getTask(database, taskId)!.revision).toBe(2);
      expect(getAttempts(database, taskId)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("retries a created attempt whose host observation is stale", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Stale host",
        level: 1,
        reason: "reason",
      }).taskId;
      const runResult = run(database, taskId);
      const attemptId = runResult.nodeBrief!.attemptId;
      database
        .prepare(
          `INSERT INTO agent_runs (
             id, task_id, node_attempt_id, host, host_run_id, host_session_id,
             observation_status, last_seen_at, finish_reason, observation_json
           ) VALUES (?, ?, ?, 'codex', 'run-1', NULL, 'stale', ?, NULL, '{}')`,
        )
        .run("ar-1", taskId, attemptId, "2026-08-11T00:00:00.000Z");

      const result = runRetry(database, taskId, { attemptId, reason: "stale" });

      expect(result.successorAttemptId).toBe(`att-${taskId}-execute-1-2`);
      expect(result.nodeBrief?.attemptId).toBe(`att-${taskId}-execute-1-2`);
      expect(getAttempts(database, taskId)).toEqual([
        expect.objectContaining({
          attemptNumber: 1,
          status: "superseded",
          outcome: "superseded",
          finishedAt: expect.any(String),
        }),
        expect.objectContaining({ attemptNumber: 2, status: "created" }),
      ]);
    } finally {
      database.close();
    }
  });

  it("rejects retrying an older attempt after its successor exists", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "No duplicate successor",
        level: 1,
        reason: "reason",
      }).taskId;
      const first = run(database, taskId).nodeBrief!.attemptId;
      runFail(database, taskId, { attemptId: first, reason: "failed" });
      runRetry(database, taskId, { attemptId: first, reason: "retry once" });

      const error = captureTaskcraftError(() =>
        runRetry(database, taskId, {
          attemptId: first,
          reason: "duplicate retry",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(getAttempts(database, taskId)).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("opens the exhaustion blocker when the budget is spent and none is open", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Budget spent",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);
      database
        .prepare(
          `UPDATE node_attempts SET status = 'failed', outcome = 'failed',
                  finished_at = ? WHERE id = ?`,
        )
        .run("2026-08-11T00:00:00.000Z", `att-${taskId}-execute-1-1`);
      insertFailedAttempts(database, taskId, 2, 3);

      const result = runRetry(database, taskId, {
        attemptId: `att-${taskId}-execute-1-3`,
        reason: "stale",
      });

      expect(result.successorAttemptId).toBeNull();
      const projection = project(database, taskId);
      expect(projection.status).toBe("waiting");
      expect(projection.waitingReason).toBe("failed_retries_exhausted");
      expect(getOpenBlockers(database, taskId)[0]).toMatchObject({
        kind: "evidence",
        waitingReason: "failed_retries_exhausted",
      });
      expect(
        queryEvents(database, taskId).map((event) => event.eventType),
      ).toEqual(["task.created", "task.activated", "task.waiting"]);
    } finally {
      database.close();
    }
  });

  it("rejects a retry while a non-exhaustion blocker is open with TC_BLOCKER_UNRESOLVED", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Waiting, not retryable",
        level: 1,
        reason: "reason",
      }).taskId;
      const runResult = run(database, taskId);
      taskWait(database, taskId, {
        reasonCode: "needs_input",
        message: "Which schema?",
      });

      // the wait ended the attempt as failed/blocked, which alone would pass
      // the retryable check; the open blocker must stop the retry so the
      // successor cannot win over the blocker in the projector
      const error = captureTaskcraftError(() =>
        runRetry(database, taskId, {
          attemptId: runResult.nodeBrief!.attemptId,
          reason: "why",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_BLOCKER_UNRESOLVED);
      expect(error.remediation).toContain("tc task resume");
      // zero writes: no successor attempt, the blocker stays open
      expect(getAttempts(database, taskId)).toHaveLength(1);
      expect(getOpenBlockers(database, taskId)).toHaveLength(1);
      expect(getTask(database, taskId)!.revision).toBe(3);
      expect(project(database, taskId).status).toBe("waiting");
    } finally {
      database.close();
    }
  });

  it("rejects a retry past the budget with TC_RETRY_BUDGET_EXHAUSTED and zero writes", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Exhausted",
        level: 1,
        reason: "reason",
      }).taskId;

      for (let index = 1; index <= 3; index += 1) {
        failOnce(database, taskId, index);
      }

      const before = getTask(database, taskId)!;
      const error = captureTaskcraftError(() =>
        runRetry(database, taskId, {
          attemptId: `att-${taskId}-execute-1-3`,
          reason: "one more try",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_RETRY_BUDGET_EXHAUSTED);
      expect(error.remediation).toContain("--resolve");
      expect(getTask(database, taskId)!.revision).toBe(before.revision);
      expect(getAttempts(database, taskId)).toHaveLength(3);
      expect(queryEvents(database, taskId)).toHaveLength(7);
    } finally {
      database.close();
    }
  });

  it("rejects an empty reason with TC_TASK_INPUT_INVALID", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "No reason",
        level: 1,
        reason: "reason",
      }).taskId;
      const runResult = run(database, taskId);
      runFail(database, taskId, {
        attemptId: runResult.nodeBrief!.attemptId,
        reason: "boom",
      });

      const error = captureTaskcraftError(() =>
        runRetry(database, taskId, {
          attemptId: runResult.nodeBrief!.attemptId,
          reason: "  ",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_INPUT_INVALID);
    } finally {
      database.close();
    }
  });
});
