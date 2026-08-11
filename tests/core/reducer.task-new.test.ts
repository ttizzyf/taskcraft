import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { project } from "../../src/core/projector.js";
import { taskNew } from "../../src/core/reducer.js";
import {
  getLastEventSeq,
  getLifecycle,
  getTask,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import { countEvents, countTasks, queryEvents } from "./reducer-utils.js";

describe("reducer taskNew", () => {
  it("writes the task, the L1 graph and the task.created event (revision 1, task_seq 1)", () => {
    const database = createMigratedDatabase();

    try {
      const result = taskNew(database, {
        title: "Fix typo",
        level: 1,
        reason: "Local reversible text change",
      });

      expect(result.taskId).toBe("T-1");
      expect(result.taskRevision).toBe(1);
      expect(result.status).toBe("queued");
      expect(result.next).toBe("tc run T-1");
      expect(result.waitingReason).toBeNull();

      const task = getTask(database, "T-1")!;
      expect(task.revision).toBe(1);
      expect(task.currentLifecycleRevision).toBe(1);
      expect(task.activatedAt).toBeNull();
      expect(task.cancelledAt).toBeNull();

      const graph = getLifecycle(database, "T-1", 1);
      expect(graph.nodes.map((node) => node.id)).toEqual([
        "execute-1",
        "record-1",
      ]);
      expect(
        graph.edges.map((edge) => [edge.fromNodeId, edge.toNodeId]),
      ).toEqual([["execute-1", "record-1"]]);
      expect(graph.obligations.map((obligation) => obligation.id)).toEqual([
        "minimum-validation-recorded",
        "requested-outcome-produced",
        "result-and-scope-retained",
      ]);
      expect(
        graph.obligations.every((obligation) => obligation.duty === "required"),
      ).toBe(true);

      expect(queryEvents(database, "T-1")).toEqual([
        expect.objectContaining({
          taskSeq: 1,
          eventType: "task.created",
          postTaskRevision: 1,
        }),
      ]);
      expect(getLastEventSeq(database, "T-1")).toBe(1);
      expect(project(database, "T-1").status).toBe("queued");
    } finally {
      database.close();
    }
  });

  it("rejects unsupported levels with TC_TASK_LEVEL_UNSUPPORTED and writes nothing", () => {
    const database = createMigratedDatabase();

    try {
      const error = captureTaskcraftError(() =>
        taskNew(database, {
          title: "L2 task",
          level: 2,
          reason: "Needs review",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_LEVEL_UNSUPPORTED);
      expect(countTasks(database)).toBe(0);
      expect(countEvents(database)).toBe(0);
    } finally {
      database.close();
    }
  });

  it("rejects an empty title with TC_TASK_INPUT_INVALID", () => {
    const database = createMigratedDatabase();

    try {
      const error = captureTaskcraftError(() =>
        taskNew(database, { title: "   ", level: 1, reason: "reason" }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_INPUT_INVALID);
      expect(countTasks(database)).toBe(0);
    } finally {
      database.close();
    }
  });

  it("issues sequential task ids across task creations", () => {
    const database = createMigratedDatabase();

    try {
      taskNew(database, { title: "First", level: 1, reason: "reason" });
      const second = taskNew(database, {
        title: "Second",
        level: 1,
        reason: "reason",
      });

      expect(second.taskId).toBe("T-2");
    } finally {
      database.close();
    }
  });
});
