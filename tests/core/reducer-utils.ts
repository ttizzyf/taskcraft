// Shared assertions and query helpers for the reducer test suites.

import { expect } from "vitest";

import type { TaskcraftDatabase } from "../../src/store/database.js";
import {
  getAttempts,
  getEvidence,
  getLastEventSeq,
  getTask,
} from "../../src/store/query.js";

export const VALID_RESULT = {
  summary: "Typo fixed",
  evidence: [
    {
      type: "validation",
      reference: "ref://validation",
      summary: "Spellcheck passes",
    },
    { type: "test", reference: "ref://test", summary: "Docs build" },
  ],
  record: { summary: "Recorded" },
};

/** Asserts a failed reducer command left the task exactly as it was:
 * no evidence, attempt still running, revision and event counter unchanged. */
export function expectZeroFacts(
  database: TaskcraftDatabase,
  taskId: string,
  expectedRevision: number,
): void {
  expect(getEvidence(database, taskId)).toHaveLength(0);
  expect(getAttempts(database, taskId)[0]).toMatchObject({ status: "created" });
  expect(getTask(database, taskId)!.revision).toBe(expectedRevision);
  expect(getLastEventSeq(database, taskId)).toBe(expectedRevision);
}

export function queryEvents(
  database: TaskcraftDatabase,
  taskId: string,
): Array<{ taskSeq: number; eventType: string; postTaskRevision: number }> {
  return database
    .prepare(
      `SELECT task_seq AS taskSeq, event_type AS eventType,
              post_task_revision AS postTaskRevision
       FROM events WHERE task_id = ? ORDER BY task_seq`,
    )
    .all(taskId) as Array<{
    taskSeq: number;
    eventType: string;
    postTaskRevision: number;
  }>;
}

export function countTasks(database: TaskcraftDatabase): number {
  return (
    database.prepare("SELECT COUNT(*) AS count FROM tasks").get() as {
      count: number;
    }
  ).count;
}

export function countAttempts(database: TaskcraftDatabase): number {
  return (
    database.prepare("SELECT COUNT(*) AS count FROM node_attempts").get() as {
      count: number;
    }
  ).count;
}

export function countEvents(database: TaskcraftDatabase): number {
  return (
    database.prepare("SELECT COUNT(*) AS count FROM events").get() as {
      count: number;
    }
  ).count;
}
