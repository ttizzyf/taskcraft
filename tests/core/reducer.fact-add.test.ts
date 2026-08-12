import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import {
  taskFactAdd,
  taskNew,
  type TaskFactAddInput,
} from "../../src/core/reducer.js";
import {
  getLastEventSeq,
  getTask,
  getTaskFacts,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import { setupL2ToReview } from "./reducer-utils.js";

function validFact(taskId: string, attemptId: string) {
  return {
    taskId,
    attemptId,
    category: "probe" as const,
    subject: "api-availability",
    value: { status: "reachable" },
  };
}

describe("reducer taskFactAdd", () => {
  it("writes the fact row, the audit event and bumps the revision", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      const revisionBefore = getTask(database, taskId)!.revision;

      const result = taskFactAdd(database, taskId, {
        ...validFact(taskId, executeAttemptId),
      });

      expect(result.factId).toBe(`fact-${taskId}-1`);
      expect(result.taskRevision).toBe(revisionBefore + 1);
      expect(getTask(database, taskId)!.revision).toBe(revisionBefore + 1);

      const facts = getTaskFacts(database, taskId);
      expect(facts).toEqual([
        expect.objectContaining({
          id: `fact-${taskId}-1`,
          category: "probe",
          subject: "api-availability",
          sourceAttemptId: executeAttemptId,
          evidenceId: null,
          supersedesFactId: null,
        }),
      ]);
      expect(JSON.parse(facts[0]!.valueJson)).toEqual({
        status: "reachable",
      });

      const events = database
        .prepare(
          `SELECT event_type AS eventType, task_seq AS taskSeq,
                  attempt_id AS attemptId, post_task_revision AS postTaskRevision
           FROM events WHERE task_id = ? ORDER BY task_seq`,
        )
        .all(taskId) as Array<{
        eventType: string;
        taskSeq: number;
        attemptId: string;
        postTaskRevision: number;
      }>;
      expect(events.at(-1)).toMatchObject({
        eventType: "task.fact.added",
        taskSeq: getLastEventSeq(database, taskId),
        attemptId: executeAttemptId,
        postTaskRevision: revisionBefore + 1,
      });
    } finally {
      database.close();
    }
  });

  it("is append-only: update and delete of a fact row are rejected by the store", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      taskFactAdd(database, taskId, validFact(taskId, executeAttemptId));

      expect(() =>
        database
          .prepare("UPDATE task_facts SET subject = ? WHERE id = ?")
          .run("rewritten", `fact-${taskId}-1`),
      ).toThrow(/append-only|task_facts_immutable/i);
      expect(() =>
        database
          .prepare("DELETE FROM task_facts WHERE id = ?")
          .run(`fact-${taskId}-1`),
      ).toThrow(/append-only|task_facts_immutable/i);
      expect(getTaskFacts(database, taskId)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("keeps a superseded fact queryable and links the new fact to it", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      taskFactAdd(database, taskId, {
        ...validFact(taskId, executeAttemptId),
        subject: "api-base-url",
        value: { url: "https://v1" },
      });
      taskFactAdd(database, taskId, {
        ...validFact(taskId, executeAttemptId),
        subject: "api-base-url",
        value: { url: "https://v2" },
        supersedesFactId: `fact-${taskId}-1`,
      });

      const facts = getTaskFacts(database, taskId);
      expect(facts).toHaveLength(2);
      expect(facts[0]).toMatchObject({
        id: `fact-${taskId}-1`,
        supersedesFactId: null,
      });
      expect(facts[1]).toMatchObject({
        id: `fact-${taskId}-2`,
        supersedesFactId: `fact-${taskId}-1`,
      });
      expect(JSON.parse(facts[1]!.valueJson)).toEqual({ url: "https://v2" });
    } finally {
      database.close();
    }
  });

  it("rejects an attempt that is not of the current revision with zero writes", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = setupL2ToReview(database);
      const revision = getTask(database, taskId)!.revision;

      const error = captureTaskcraftError(() =>
        taskFactAdd(database, taskId, {
          ...validFact(taskId, "att-missing-execute-9"),
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(getTaskFacts(database, taskId)).toHaveLength(0);
      expect(getTask(database, taskId)!.revision).toBe(revision);
      expect(getLastEventSeq(database, taskId)).toBe(revision);
    } finally {
      database.close();
    }
  });

  it("rejects invalid category, empty subject and non-object values", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);

      const invalidInputs: Array<Record<string, unknown>> = [
        { ...validFact(taskId, executeAttemptId), category: "gossip" },
        { ...validFact(taskId, executeAttemptId), subject: "   " },
        { ...validFact(taskId, executeAttemptId), value: [1, 2] },
        { ...validFact(taskId, executeAttemptId), value: "text" },
        { ...validFact(taskId, executeAttemptId), value: null },
      ];

      for (const input of invalidInputs) {
        const error = captureTaskcraftError(() =>
          taskFactAdd(database, taskId, input as unknown as TaskFactAddInput),
        );
        expect(error.code).toBe(ERROR_CODES.TC_FACT_INPUT_INVALID);
      }

      expect(getTaskFacts(database, taskId)).toHaveLength(0);
      expect(getTask(database, taskId)!.revision).toBe(5);
    } finally {
      database.close();
    }
  });

  it("rejects an evidence reference that does not exist for the task", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);

      const error = captureTaskcraftError(() =>
        taskFactAdd(database, taskId, {
          ...validFact(taskId, executeAttemptId),
          evidenceId: "ev-other-task-1",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_EVIDENCE_REF_INVALID);
      expect(getTaskFacts(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects a supersedes reference that does not exist for the task", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);

      const error = captureTaskcraftError(() =>
        taskFactAdd(database, taskId, {
          ...validFact(taskId, executeAttemptId),
          supersedesFactId: "fact-other-task-1",
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_FACT_SUPERSEDE_INVALID);
      expect(getTaskFacts(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects a stale expected revision with TC_REVISION_CONFLICT", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      const current = getTask(database, taskId)!.revision;

      const error = captureTaskcraftError(() =>
        taskFactAdd(database, taskId, {
          ...validFact(taskId, executeAttemptId),
          expectedRevision: current - 1,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REVISION_CONFLICT);
      expect(getTaskFacts(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("stores the value payload verbatim without content inspection", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId, executeAttemptId } = setupL2ToReview(database);
      // The secret boundary is the caller's contract: the reducer stores the
      // plain-object payload as-is and never inspects its contents.
      const payload = { credential: "token-123", endpoint: "https://x" };

      taskFactAdd(database, taskId, {
        ...validFact(taskId, executeAttemptId),
        category: "constraint",
        subject: "host-credential",
        value: payload,
      });

      expect(JSON.parse(getTaskFacts(database, taskId)[0]!.valueJson)).toEqual(
        payload,
      );
    } finally {
      database.close();
    }
  });

  it("rejects fact add on a cancelled task", () => {
    const database = createMigratedDatabase();

    try {
      const { taskId } = taskNew(database, {
        title: "Cancelled",
        level: 1,
        reason: "reason",
      });
      database
        .prepare(
          "UPDATE tasks SET cancelled_at = ?, cancel_reason = ? WHERE id = ?",
        )
        .run("2026-08-11T00:00:00.000Z", "cancelled by test", taskId);

      const error = captureTaskcraftError(() =>
        taskFactAdd(database, taskId, {
          ...validFact(taskId, "att-any-1"),
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_ALREADY_CANCELLED);
      expect(getTaskFacts(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});
