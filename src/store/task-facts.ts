// Read-only query for appended task facts, kept in its own file so the
// query model stays under the 400 effective-line limit. task_facts is
// append-only (update/delete triggers in storage.sql); a superseded fact
// stays queryable and the newest row wins for reads.

import type { TaskcraftDatabase } from "./database.js";

export interface TaskFactRow {
  id: string;
  taskId: string;
  category: string;
  subject: string;
  valueJson: string;
  sourceAttemptId: string;
  evidenceId: string | null;
  supersedesFactId: string | null;
  createdBy: string;
  createdAt: string;
}

export function getTaskFacts(
  database: TaskcraftDatabase,
  taskId: string,
): TaskFactRow[] {
  return database
    .prepare(
      `SELECT id, task_id AS taskId,
              category, subject,
              value_json AS valueJson,
              source_attempt_id AS sourceAttemptId,
              evidence_id AS evidenceId,
              supersedes_fact_id AS supersedesFactId,
              created_by AS createdBy,
              created_at AS createdAt
       FROM task_facts
       WHERE task_id = ?
       ORDER BY created_at, id`,
    )
    .all(taskId) as TaskFactRow[];
}
