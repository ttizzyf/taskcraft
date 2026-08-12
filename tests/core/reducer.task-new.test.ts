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
import { countTasks, queryEvents } from "./reducer-utils.js";

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

  it("materializes the L2 graph for level 2", () => {
    const database = createMigratedDatabase();

    try {
      const l2 = taskNew(database, {
        title: "L2 task",
        level: 2,
        reason: "Needs review",
      });

      expect(l2.taskId).toBe("T-1");
      expect(l2.status).toBe("queued");
      expect(l2.next).toBe("tc run T-1 --node frame-1");

      const graph = getLifecycle(database, "T-1", 1);
      expect(graph.nodes.map((node) => [node.id, node.kind])).toEqual([
        ["frame-1", "frame"],
        ["execute-1", "execute"],
        ["review-1", "review"],
        ["record-1", "record"],
      ]);
      expect(
        graph.edges.map((edge) => [edge.fromNodeId, edge.toNodeId]),
      ).toEqual([
        ["execute-1", "review-1"],
        ["frame-1", "execute-1"],
        ["review-1", "record-1"],
      ]);
      expect(graph.obligations.map((obligation) => obligation.id)).toEqual([
        "minimum-validation-recorded",
        "requested-outcome-produced",
        "frame-completed",
        "result-and-scope-retained",
        "review-completed",
      ]);
    } finally {
      database.close();
    }
  });

  it("materializes the L3 graph for level 3 (covered in detail by projector.l3)", () => {
    const database = createMigratedDatabase();

    try {
      const l3 = taskNew(database, {
        title: "L3 task",
        level: 3,
        reason: "Initiative",
      });

      expect(l3.taskId).toBe("T-1");
      expect(l3.status).toBe("queued");
      expect(l3.next).toBe("tc run T-1 --node frame-1");

      const graph = getLifecycle(database, "T-1", 1);
      expect(graph.nodes).toHaveLength(8);
      expect(graph.nodes.map((node) => node.kind)).toEqual([
        "frame",
        "plan",
        "review",
        "execute",
        "review",
        "integrate",
        "review",
        "record",
      ]);
      expect(graph.obligations).toHaveLength(9);
      expect(graph.obligations.map((obligation) => obligation.id)).toEqual([
        "minimum-validation-recorded",
        "requested-outcome-produced",
        "frame-completed",
        "integration-completed",
        "plan-completed",
        "result-and-scope-retained",
        "delivery-completed",
        "integration-review-completed",
        "feasibility-completed",
      ]);
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

  it("persists classificationFacts verbatim and defaults them to an empty object", () => {
    const database = createMigratedDatabase();

    try {
      const facts = { domain: "docs", risk: "low" };
      const withFacts = taskNew(database, {
        title: "Facts task",
        level: 1,
        reason: "reason",
        classificationFacts: facts,
      });

      const row = database
        .prepare(
          "SELECT classification_facts_json AS facts FROM tasks WHERE id = ?",
        )
        .get(withFacts.taskId) as { facts: string };
      expect(JSON.parse(row.facts)).toEqual(facts);

      const withoutFacts = taskNew(database, {
        title: "Plain task",
        level: 1,
        reason: "reason",
      });
      const plainRow = database
        .prepare(
          "SELECT classification_facts_json AS facts FROM tasks WHERE id = ?",
        )
        .get(withoutFacts.taskId) as { facts: string };
      expect(plainRow.facts).toBe("{}");
    } finally {
      database.close();
    }
  });

  it("rejects classification facts that are not a JSON object", () => {
    const database = createMigratedDatabase();

    try {
      for (const badFacts of [[1, 2], "text", 42, null]) {
        const error = captureTaskcraftError(() =>
          taskNew(database, {
            title: "Bad facts",
            level: 1,
            reason: "reason",
            classificationFacts: badFacts,
          }),
        );

        expect(error.code).toBe(ERROR_CODES.TC_TASK_INPUT_INVALID);
      }

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
