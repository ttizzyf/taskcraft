import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { project } from "../../src/core/projector.js";
import {
  run,
  runComplete,
  taskFactAdd,
  taskNew,
  taskResume,
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

const RESULT = {
  summary: "done",
  evidence: [{ type: "validation", reference: "r", summary: "ok" }],
  record: { summary: "recorded" },
};

function activatedTask(
  database: ReturnType<typeof createMigratedDatabase>,
  title = "Wait me",
): string {
  const { taskId } = taskNew(database, { title, level: 1, reason: "reason" });
  run(database, taskId);
  return taskId;
}

describe("reducer taskWait", () => {
  it.each(["needs_input", "needs_decision", "blocked_dependency"] as const)(
    "opens a blocker with the matching kind and waiting reason for %s",
    (reasonCode) => {
      const database = createMigratedDatabase();

      try {
        const taskId = activatedTask(database);
        const result = taskWait(database, taskId, {
          reasonCode,
          message: "Need the schema decision",
        });

        expect(result.status).toBe("waiting");
        expect(result.waitingReason).toBe(reasonCode);
        expect(result.next).toBe(`tc task resume ${taskId}`);

        const blockers = getOpenBlockers(database, taskId);
        expect(blockers).toHaveLength(1);
        expect(blockers[0]).toMatchObject({
          kind: reasonCode === "blocked_dependency" ? "dependency" : reasonCode,
          waitingReason: reasonCode,
          status: "open",
          nodeId: "execute-1",
          remediationCommand: `tc task resume ${taskId}`,
        });

        // the running attempt is ended so the projector derives waiting
        expect(getAttempts(database, taskId)).toEqual([
          expect.objectContaining({ status: "failed", outcome: "blocked" }),
        ]);
        expect(
          queryEvents(database, taskId).map((event) => event.eventType),
        ).toEqual(["task.created", "task.activated", "task.waiting"]);
      } finally {
        database.close();
      }
    },
  );

  it("writes the blocker, event and revision bump atomically", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);
      const before = getTask(database, taskId)!;
      const result = taskWait(database, taskId, {
        reasonCode: "needs_input",
        message: "m",
      });

      expect(result.taskRevision).toBe(before.revision + 1);
      expect(queryEvents(database, taskId)).toEqual([
        expect.objectContaining({ taskSeq: 1, eventType: "task.created" }),
        expect.objectContaining({ taskSeq: 2, eventType: "task.activated" }),
        expect.objectContaining({
          taskSeq: 3,
          eventType: "task.waiting",
          postTaskRevision: before.revision + 1,
        }),
      ]);
    } finally {
      database.close();
    }
  });

  it("accepts an explicit node that exists in the current revision graph", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);
      taskWait(database, taskId, {
        reasonCode: "blocked_dependency",
        message: "Waiting on the probe service",
        nodeId: "execute-1",
      });

      expect(getOpenBlockers(database, taskId)[0]).toMatchObject({
        nodeId: "execute-1",
        waitingReason: "blocked_dependency",
      });
    } finally {
      database.close();
    }
  });

  it("rejects an unknown --node with TC_ATTEMPT_REF_INVALID", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);
      const error = captureTaskcraftError(() =>
        taskWait(database, taskId, {
          reasonCode: "needs_input",
          message: "m",
          nodeId: "no-such-node",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(getTask(database, taskId)!.revision).toBe(2);
    } finally {
      database.close();
    }
  });

  it("rejects a queued task with TC_TASK_NOT_ACTIVATED", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Never activated",
        level: 1,
        reason: "reason",
      }).taskId;
      const error = captureTaskcraftError(() =>
        taskWait(database, taskId, { reasonCode: "needs_input", message: "m" }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_NOT_ACTIVATED);
      expect(getOpenBlockers(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects a second open blocker with TC_BLOCKER_ALREADY_OPEN", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);
      taskWait(database, taskId, {
        reasonCode: "needs_input",
        message: "first",
      });
      const error = captureTaskcraftError(() =>
        taskWait(database, taskId, {
          reasonCode: "needs_decision",
          message: "second",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_BLOCKER_ALREADY_OPEN);
      expect(getOpenBlockers(database, taskId)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("rejects an empty message and an invalid reason code with zero writes", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);

      const emptyMessage = captureTaskcraftError(() =>
        taskWait(database, taskId, {
          reasonCode: "needs_input",
          message: "  ",
        }),
      );
      expect(emptyMessage.code).toBe(ERROR_CODES.TC_TASK_INPUT_INVALID);

      const badReason = captureTaskcraftError(() =>
        taskWait(database, taskId, {
          reasonCode: "not-a-reason" as "needs_input",
          message: "m",
        }),
      );
      expect(badReason.code).toBe(ERROR_CODES.TC_TASK_INPUT_INVALID);

      expect(getOpenBlockers(database, taskId)).toHaveLength(0);
      expect(getTask(database, taskId)!.revision).toBe(2);
      expect(queryEvents(database, taskId)).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("rejects a stale expected revision with TC_REVISION_CONFLICT", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);
      const error = captureTaskcraftError(() =>
        taskWait(database, taskId, {
          reasonCode: "needs_input",
          message: "m",
          expectedRevision: 1,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVISION_CONFLICT);
      expect(getOpenBlockers(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});

describe("reducer taskResume", () => {
  it("resolves the blocker with --resolve and projects active", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);
      taskWait(database, taskId, {
        reasonCode: "needs_decision",
        message: "Approve the plan?",
      });

      const result = taskResume(database, taskId, { resolve: true });

      expect(result.status).toBe("active");
      expect(result.next).toBe(`tc run ${taskId} --node execute-1`);
      expect(getOpenBlockers(database, taskId)).toHaveLength(0);
      expect(
        queryEvents(database, taskId).map((event) => event.eventType),
      ).toEqual([
        "task.created",
        "task.activated",
        "task.waiting",
        "task.resumed",
      ]);
    } finally {
      database.close();
    }
  });

  it("resolves the blocker when a constraint fact was written after it opened", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);
      taskWait(database, taskId, {
        reasonCode: "needs_input",
        message: "Which schema?",
      });

      taskFactAdd(database, taskId, {
        taskId,
        attemptId: `att-${taskId}-execute-1-1`,
        category: "constraint",
        subject: "schema",
        value: { decision: "v2" },
      });

      const result = taskResume(database, taskId, {});

      expect(result.status).toBe("active");
      expect(result.next).toBe(`tc run ${taskId} --node execute-1`);
      expect(getOpenBlockers(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects an unanswered blocker with TC_BLOCKER_UNRESOLVED and zero writes", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);
      taskWait(database, taskId, { reasonCode: "needs_input", message: "m" });

      const error = captureTaskcraftError(() =>
        taskResume(database, taskId, {}),
      );

      expect(error.code).toBe(ERROR_CODES.TC_BLOCKER_UNRESOLVED);
      expect(error.remediation).toContain("--category constraint");
      expect(error.remediation).toContain("--resolve");

      // no fact was written, the blocker stays open, revision and events unchanged
      expect(getOpenBlockers(database, taskId)).toHaveLength(1);
      expect(getTask(database, taskId)!.revision).toBe(3);
      expect(queryEvents(database, taskId)).toHaveLength(3);
      expect(project(database, taskId).status).toBe("waiting");
    } finally {
      database.close();
    }
  });

  it("rejects a resume without an open blocker with TC_BLOCKER_UNRESOLVED", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);
      const error = captureTaskcraftError(() =>
        taskResume(database, taskId, { resolve: true }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_BLOCKER_UNRESOLVED);
    } finally {
      database.close();
    }
  });

  it("rejects a stale expected revision with TC_REVISION_CONFLICT", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);
      taskWait(database, taskId, { reasonCode: "needs_input", message: "m" });

      const error = captureTaskcraftError(() =>
        taskResume(database, taskId, { resolve: true, expectedRevision: 1 }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVISION_CONFLICT);
      expect(getOpenBlockers(database, taskId)).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});

describe("waiting loop active -> waiting -> active -> done", () => {
  it("completes the full lifecycle through the fact-add resume path", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);
      taskWait(database, taskId, {
        reasonCode: "needs_input",
        message: "Which schema?",
      });
      expect(project(database, taskId).status).toBe("waiting");

      taskFactAdd(database, taskId, {
        taskId,
        attemptId: `att-${taskId}-execute-1-1`,
        category: "constraint",
        subject: "schema",
        value: { decision: "v2" },
      });

      const resumed = taskResume(database, taskId, {});
      expect(resumed.status).toBe("active");
      expect(resumed.next).toBe(`tc run ${taskId} --node execute-1`);

      // the successor attempt is claimed and the loop closes
      run(database, taskId, { nodeId: "execute-1" });
      const done = runComplete(database, taskId, { result: RESULT });

      expect(done.status).toBe("done");
      expect(
        getAttempts(database, taskId).filter(
          (attempt) => attempt.nodeId === "execute-1",
        ),
      ).toEqual([
        expect.objectContaining({ attemptNumber: 1, status: "failed" }),
        expect.objectContaining({ attemptNumber: 2, status: "finished" }),
      ]);
    } finally {
      database.close();
    }
  });

  it("projects waiting with the earliest open blocker and its remediation", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = activatedTask(database);
      taskWait(database, taskId, {
        reasonCode: "blocked_dependency",
        message: "Probe service unreachable",
      });

      const projection = project(database, taskId);

      expect(projection.status).toBe("waiting");
      expect(projection.waitingReason).toBe("blocked_dependency");
      expect(projection.runnableNodes).toEqual([]);
      expect(projection.runningNode).toBeNull();
      expect(projection.next).toBe(`tc task resume ${taskId}`);
      expect(projection.breadcrumb.blocked).toEqual(["blocked_dependency"]);
    } finally {
      database.close();
    }
  });
});
