// Shared assertions and query helpers for the reducer test suites.

import { expect } from "vitest";

import type { TaskcraftDatabase } from "../../src/store/database.js";
import { run, runComplete, taskNew } from "../../src/core/reducer.js";
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
  record: {
    summary: "Recorded",
    specImpact: { outcome: "none", reason: "No reusable rule changed" },
  },
};

export const L2_FRAME_RESULT = {
  objective: "Frame the retry policy",
  scope: { modules: ["core"] },
  acceptance: ["Retry policy is configurable per adapter"],
  specBindings: [],
};

export const L2_EXECUTE_RESULT = {
  summary: "Retry policy implemented",
  evidence: [
    { type: "validation", reference: "ref://validation", summary: "Validated" },
    { type: "test", reference: "ref://test", summary: "Tests pass" },
  ],
};

/** Creates an L2 task and drives it to the review point: frame and execute
 * finished, review-1 runnable. Returns the task id and the ids of the frame
 * and execute attempts. */
export function setupL2ToReview(
  database: TaskcraftDatabase,
  title = "L2 review task",
): { taskId: string; executeAttemptId: string } {
  const { taskId } = taskNew(database, { title, level: 2, reason: "reason" });
  run(database, taskId, { nodeId: "frame-1" });
  runComplete(database, taskId, { nodeId: "frame-1", result: L2_FRAME_RESULT });
  run(database, taskId, { nodeId: "execute-1" });
  runComplete(database, taskId, { result: L2_EXECUTE_RESULT });

  return { taskId, executeAttemptId: `att-${taskId}-execute-1-1` };
}

export function reviewStartInput(
  taskId: string,
  reviewedAttemptId: string,
): {
  taskId: string;
  purpose: "delivery";
  reviewedAttemptId: string;
  capability: "context-only";
  independenceStatus: "same-actor";
} {
  return {
    taskId,
    purpose: "delivery",
    reviewedAttemptId,
    capability: "context-only",
    independenceStatus: "same-actor",
  };
}

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
