// taskFactAdd: appends one task fact discovered by an attempt of the current
// revision. One transaction validates the source attempt, the category enum,
// a non-empty subject, a plain-object value and the optional evidence and
// supersedes references, then writes the fact row and the task.fact.added
// audit event. task_facts is append-only (update/delete triggers in
// storage.sql); a superseded fact stays queryable and the newest row wins.
// The value payload is stored verbatim: the secret boundary is enforced by
// the caller, never by content inspection here.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getAttempts, getEvidence, getTaskFacts } from "../../store/query.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import type { CommandData } from "./context.js";
import {
  assertNotCancelled,
  attemptRefError,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import { bumpRevision, insertEvent, nowIso } from "./shared.js";

export type TaskFactCategory =
  | "intent"
  | "probe"
  | "constraint"
  | "assumption"
  | "dependency"
  | "environment";

export const TASK_FACT_CATEGORIES: readonly TaskFactCategory[] = Object.freeze([
  "intent",
  "probe",
  "constraint",
  "assumption",
  "dependency",
  "environment",
]);

export interface TaskFactAddInput {
  taskId: string;
  expectedRevision?: number;
  /** The attempt of the current revision that discovered the fact. */
  attemptId: string;
  category: TaskFactCategory;
  subject: string;
  /** Fact payload: must be a plain JSON object (secrets never enter the
   * store; the caller owns that boundary). */
  value: unknown;
  /** Optional evidence row of the same task backing the fact. */
  evidenceId?: string;
  /** Optional fact of the same task this fact supersedes. */
  supersedesFactId?: string;
  actorInstanceId?: string;
}

export interface TaskFactResult extends CommandData {
  factId: string;
}

export function taskFactAdd(
  database: TaskcraftDatabase,
  taskId: string,
  input: TaskFactAddInput,
): TaskFactResult {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);
    const revision = snapshot.currentLifecycleRevision;
    const source = getAttempts(database, taskId).find(
      (attempt) => attempt.id === input.attemptId,
    );

    if (source === undefined || source.lifecycleRevision !== revision) {
      throw attemptRefError(
        taskId,
        `Attempt ${input.attemptId} is not an attempt of the current lifecycle revision`,
        "Pass the attempt id from: tc task show <task-id> --json",
      );
    }

    validateFactInput(database, taskId, input);

    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const now = nowIso();
    const factId = nextFactId(database, taskId);

    database
      .prepare(
        `INSERT INTO task_facts (
           id, task_id, category, subject, value_json, source_attempt_id,
           evidence_id, supersedes_fact_id, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        factId,
        taskId,
        input.category,
        input.subject,
        JSON.stringify(input.value),
        input.attemptId,
        input.evidenceId ?? null,
        input.supersedesFactId ?? null,
        actor,
        now,
      );
    insertEvent(database, {
      taskId,
      lifecycleRevision: revision,
      nodeId: source.nodeId,
      attemptId: source.id,
      eventType: "task.fact.added",
      payload: {
        category: input.category,
        subject: input.subject,
        evidenceId: input.evidenceId ?? null,
        supersedesFactId: input.supersedesFactId ?? null,
      },
      postTaskRevision: snapshot.revision + 1,
      actorInstanceId: actor,
      host: source.host,
      occurredAt: now,
    });
    bumpRevision(database, snapshot, now);

    return {
      ...commandData(database, taskId, snapshotOf(database, taskId)),
      factId,
    };
  });
}

function validateFactInput(
  database: TaskcraftDatabase,
  taskId: string,
  input: TaskFactAddInput,
): void {
  if (!TASK_FACT_CATEGORIES.includes(input.category)) {
    throw factInputError(
      taskId,
      `Fact category ${input.category} is not allowed`,
      `Use one of: ${TASK_FACT_CATEGORIES.join(", ")}`,
    );
  }

  if (input.subject.trim() === "") {
    throw factInputError(
      taskId,
      "Fact subject must not be empty",
      "Retry with a non-empty --subject",
    );
  }

  if (
    input.value === null ||
    typeof input.value !== "object" ||
    Array.isArray(input.value)
  ) {
    throw factInputError(
      taskId,
      "Fact value must be a JSON object",
      'Retry with an object value, e.g. {"status": "reachable"}',
    );
  }

  if (
    input.evidenceId !== undefined &&
    !getEvidence(database, taskId).some(
      (evidence) => evidence.id === input.evidenceId,
    )
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_EVIDENCE_REF_INVALID, {
      problem: `Evidence ${input.evidenceId} does not exist for task ${taskId}`,
      impact: "No facts were written",
      remediation: "Pass an evidence id of this task, or omit the reference",
      context: { taskId, evidenceId: input.evidenceId },
    });
  }

  if (
    input.supersedesFactId !== undefined &&
    !getTaskFacts(database, taskId).some(
      (fact) => fact.id === input.supersedesFactId,
    )
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_FACT_SUPERSEDE_INVALID, {
      problem: `Fact ${input.supersedesFactId} does not exist for task ${taskId}`,
      impact: "No facts were written",
      remediation:
        "Pass an existing fact id of this task, or omit the reference",
      context: { taskId, supersedesFactId: input.supersedesFactId },
    });
  }
}

function factInputError(
  taskId: string,
  problem: string,
  remediation: string,
): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_FACT_INPUT_INVALID, {
    problem,
    impact: "No facts were written",
    remediation,
    context: { taskId },
  });
}

function nextFactId(database: TaskcraftDatabase, taskId: string): string {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM task_facts WHERE task_id = ?")
    .get(taskId) as { count: number };

  return `fact-${taskId}-${row.count + 1}`;
}
