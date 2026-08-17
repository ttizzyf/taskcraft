// Shared task-row writer. Public task creation and accepted L3 child
// materialization use this single boundary so task defaults cannot drift.

import type { TaskcraftDatabase } from "../../store/database.js";

export interface TaskRowInput {
  title: string;
  level: 1 | 2 | 3;
  objectiveMd: string;
  scope: unknown;
  acceptance: string[];
  nonGoals: string[];
  classificationFacts?: unknown;
  classificationReasons?: string[];
  parentTaskId?: string | null;
}

export function allocateTaskId(database: TaskcraftDatabase): string {
  const rows = database.prepare("SELECT id FROM tasks").all() as Array<{
    id: string;
  }>;
  const largest = rows.reduce((maximum, row) => {
    const match = /^T-(\d+)$/.exec(row.id);
    return Math.max(maximum, match === null ? 0 : Number(match[1]));
  }, 0);
  return `T-${largest + 1}`;
}

export function insertTaskRow(
  database: TaskcraftDatabase,
  taskId: string,
  input: TaskRowInput,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO tasks (
         id, title, level, objective_md, scope_json, acceptance_json,
         non_goals_json, classification_facts_json, classification_reasons_json,
         parent_task_id, activated_at, cancelled_at, cancel_reason,
         current_lifecycle_revision, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 1, 1, ?, ?)`,
    )
    .run(
      taskId,
      input.title,
      input.level,
      input.objectiveMd,
      JSON.stringify(input.scope),
      JSON.stringify(input.acceptance),
      JSON.stringify(input.nonGoals),
      JSON.stringify(input.classificationFacts ?? {}),
      JSON.stringify(input.classificationReasons ?? []),
      input.parentTaskId ?? null,
      now,
      now,
    );
}
