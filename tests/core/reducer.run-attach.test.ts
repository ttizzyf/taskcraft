// runAttach reducer contract: one agent_runs row per attach against the
// active attempt of the current lifecycle revision, CAS-guarded, with the
// observation.attached audit event. Observations never drive task status:
// the projection stays derived from attempt facts.

import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import {
  cancel,
  run,
  runAttach,
  runComplete,
  taskNew,
} from "../../src/core/reducer.js";
import { getAgentRuns, getTask } from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import { queryEvents } from "./reducer-utils.js";

describe("reducer runAttach", () => {
  it("writes one agent_runs row for the current-revision attempt plus the event", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "Attach me",
        level: 1,
        reason: "reason",
      });
      run(database, taskId, { host: "codex" });

      const result = runAttach(database, taskId, {
        nodeId: "execute-1",
        hostRunId: "hr-1",
        hostSessionId: "s-1",
        host: "codex",
        observationStatus: "running",
      });

      expect(result.runId).toBe("ar-1");
      expect(result.nodeAttemptId).toBe(`att-${taskId}-execute-1-1`);
      expect(result.observationStatus).toBe("running");
      expect(result.status).toBe("active");
      expect(result.next).toBe(`tc run complete ${taskId}`);

      const runs = getAgentRuns(database, taskId);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        id: "ar-1",
        nodeAttemptId: `att-${taskId}-execute-1-1`,
        host: "codex",
        hostRunId: "hr-1",
        hostSessionId: "s-1",
        observationStatus: "running",
        finishReason: null,
      });
      expect(runs[0]!.lastSeenAt).not.toBeNull();
      expect(JSON.parse(runs[0]!.observationJson)).toEqual({});

      expect(getTask(database, taskId)!.revision).toBe(3);
      expect(queryEvents(database, taskId).at(-1)).toMatchObject({
        eventType: "observation.attached",
        postTaskRevision: 3,
      });
    } finally {
      database.close();
    }
  });

  it("defaults to pending status and the shared cli actor", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "Default attach",
        level: 1,
        reason: "reason",
      });
      run(database, taskId);

      const result = runAttach(database, taskId, {
        nodeId: "execute-1",
        hostRunId: "hr-2",
      });

      expect(result.observationStatus).toBe("pending");
      expect(getAgentRuns(database, taskId)[0]).toMatchObject({
        host: "cli",
        observationStatus: "pending",
      });
    } finally {
      database.close();
    }
  });

  it("advances the global run id on every attach", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "Two attaches",
        level: 1,
        reason: "reason",
      });
      run(database, taskId);
      expect(
        runAttach(database, taskId, { nodeId: "execute-1", hostRunId: "a" })
          .runId,
      ).toBe("ar-1");
      expect(
        runAttach(database, taskId, { nodeId: "execute-1", hostRunId: "b" })
          .runId,
      ).toBe("ar-2");
      expect(getAgentRuns(database, taskId)).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("rejects a node without an active attempt with TC_ATTEMPT_REF_INVALID", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "No attempt",
        level: 1,
        reason: "reason",
      });

      const error = captureTaskcraftError(() =>
        runAttach(database, taskId, { nodeId: "execute-1", hostRunId: "hr" }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(getAgentRuns(database, taskId)).toHaveLength(0);
      expect(getTask(database, taskId)!.revision).toBe(1);
    } finally {
      database.close();
    }
  });

  it("rejects attaching to a finished attempt", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "Finished",
        level: 1,
        reason: "reason",
      });
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Done",
          evidence: [{ type: "validation", reference: "r", summary: "ok" }],
        },
      });

      const error = captureTaskcraftError(() =>
        runAttach(database, taskId, { nodeId: "execute-1", hostRunId: "hr" }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(getAgentRuns(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects an empty --host-run-id with TC_TASK_INPUT_INVALID", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "Empty run id",
        level: 1,
        reason: "reason",
      });
      run(database, taskId);

      const error = captureTaskcraftError(() =>
        runAttach(database, taskId, { nodeId: "execute-1", hostRunId: "  " }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_INPUT_INVALID);
      expect(getAgentRuns(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects an unknown observation status", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "Bad status",
        level: 1,
        reason: "reason",
      });
      run(database, taskId);

      const error = captureTaskcraftError(() =>
        runAttach(database, taskId, {
          nodeId: "execute-1",
          hostRunId: "hr",
          observationStatus: "zombie" as never,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_INPUT_INVALID);
      expect(getAgentRuns(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects a stale expected revision with TC_REVISION_CONFLICT", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "Stale CAS",
        level: 1,
        reason: "reason",
      });
      run(database, taskId);

      const error = captureTaskcraftError(() =>
        runAttach(database, taskId, {
          nodeId: "execute-1",
          hostRunId: "hr",
          expectedRevision: 1,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVISION_CONFLICT);
      expect(getAgentRuns(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects an unknown task and a cancelled task", () => {
    const database = createMigratedDatabase();

    try {
      const missing = captureTaskcraftError(() =>
        runAttach(database, "T-99", { nodeId: "execute-1", hostRunId: "hr" }),
      );
      expect(missing.code).toBe(ERROR_CODES.TC_TASK_NOT_FOUND);

      const { taskId } = taskNew(database, {
        title: "Cancelled",
        level: 1,
        reason: "reason",
      });
      run(database, taskId);
      cancel(database, taskId, { reason: "superseded" });

      const cancelled = captureTaskcraftError(() =>
        runAttach(database, taskId, { nodeId: "execute-1", hostRunId: "hr" }),
      );
      expect(cancelled.code).toBe(ERROR_CODES.TC_TASK_ALREADY_CANCELLED);
      expect(getAgentRuns(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});
