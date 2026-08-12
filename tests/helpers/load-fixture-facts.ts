// Appended task fact insertion for fixture imports, kept in its own file so
// load-fixture stays under the 400 effective-line limit. Facts are inserted
// in array order so supersedes chains (a fact may only supersede an earlier
// fact) stay referentially valid.

import type { TaskcraftDatabase } from "../../src/store/database.js";
import type { FixtureDocument } from "./fixture-document.js";

export const FIXED_TIMESTAMP = "2026-08-11T00:00:00.000Z";

export function insertTaskFact(
  database: TaskcraftDatabase,
  fact: FixtureDocument["taskFacts"][number],
): void {
  database
    .prepare(
      `INSERT INTO task_facts (
         id, task_id, category, subject, value_json, source_attempt_id,
         evidence_id, supersedes_fact_id, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'actor-1', ?)`,
    )
    .run(
      fact.id,
      fact.taskId,
      fact.category,
      fact.subject,
      JSON.stringify(fact.value),
      fact.sourceAttemptId,
      fact.evidenceId ?? null,
      fact.supersedesFactId ?? null,
      FIXED_TIMESTAMP,
    );
}
