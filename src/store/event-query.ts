import type { TaskcraftDatabase } from "./database.js";

export function getLastEventSeq(
  database: TaskcraftDatabase,
  taskId: string,
): number {
  const row = database
    .prepare(
      "SELECT COALESCE(MAX(task_seq), 0) AS lastSeq FROM events WHERE task_id = ?",
    )
    .get(taskId) as { lastSeq: number };

  return row.lastSeq;
}
