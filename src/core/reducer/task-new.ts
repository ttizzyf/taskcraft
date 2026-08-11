// taskNew: creates the task row (revision 1), materializes the L1 lifecycle
// into the four definition tables and appends the task.created audit event.
// No activation facts are written; the task projects as queued.

import type { TaskcraftDatabase } from "../../store/database.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import {
  L1_DEFAULT_ACTOR,
  L1_EXECUTE_NODE_ID,
  L1_EXECUTE_RESULT_SCHEMA,
  L1_FACTS_DIGEST,
  L1_OBLIGATIONS,
  L1_POLICY_DIGEST,
  L1_RECORD_NODE_ID,
  L1_RECORD_RESULT_SCHEMA,
  L1_RETRY_POLICY,
} from "../lifecycle/l1.js";
import type { CommandData, TaskNewInput } from "./context.js";
import { commandData, snapshotOf } from "./context.js";
import { insertEvent, isUniqueConstraint, nowIso } from "./shared.js";

export function taskNew(
  database: TaskcraftDatabase,
  input: TaskNewInput,
): CommandData {
  return withTransaction(database, () => {
    validateTaskNewInput(input);
    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const now = nowIso();
    let taskId = nextTaskId(database);

    try {
      insertTaskRow(database, taskId, input, now);
    } catch (cause) {
      if (!isUniqueConstraint(cause)) {
        throw cause;
      }

      taskId = nextTaskId(database);
      insertTaskRow(database, taskId, input, now);
    }

    materializeL1Lifecycle(database, taskId, input, actor, now);
    insertEvent(database, {
      taskId,
      lifecycleRevision: 1,
      nodeId: null,
      attemptId: null,
      eventType: "task.created",
      payload: { level: 1, reason: input.reason },
      postTaskRevision: 1,
      actorInstanceId: actor,
      host: null,
      occurredAt: now,
    });

    return commandData(database, taskId, snapshotOf(database, taskId));
  });
}

function validateTaskNewInput(input: TaskNewInput): void {
  if (input.level !== 1) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_LEVEL_UNSUPPORTED, {
      problem: `Level ${input.level} is not supported yet: only L1 is available`,
      impact: "The task was not created; L2/L3 graphs are not compiled",
      remediation: "Create an L1 task, or wait for the lifecycle compiler",
      context: { level: input.level },
    });
  }

  if (input.title.trim() === "" || input.reason.trim() === "") {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
      problem: "Task creation requires a non-empty title and reason",
      impact: "The task was not created",
      remediation: "Retry with --title and --reason filled in",
    });
  }

  if (
    input.classificationFacts !== undefined &&
    (input.classificationFacts === null ||
      typeof input.classificationFacts !== "object" ||
      Array.isArray(input.classificationFacts))
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
      problem:
        'Classification facts must be a JSON object, e.g. {"domain": "docs"}',
      impact: "The task was not created",
      remediation: "Retry with --facts containing a JSON object",
      context: { factsType: typeof input.classificationFacts },
    });
  }
}

function nextTaskId(database: TaskcraftDatabase): string {
  const row = database.prepare("SELECT COUNT(*) AS count FROM tasks").get() as {
    count: number;
  };

  return `T-${row.count + 1}`;
}

function insertTaskRow(
  database: TaskcraftDatabase,
  taskId: string,
  input: TaskNewInput,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO tasks (
         id, title, level, objective_md, scope_json, acceptance_json,
         non_goals_json, classification_facts_json, classification_reasons_json,
         parent_task_id, activated_at, cancelled_at, cancel_reason,
         current_lifecycle_revision, revision, created_at, updated_at
       ) VALUES (?, ?, 1, ?, '{}', '[]', '[]', ?, '[]', NULL, NULL, NULL,
         NULL, 1, 1, ?, ?)`,
    )
    .run(
      taskId,
      input.title,
      input.objectiveMd ?? input.title,
      JSON.stringify(input.classificationFacts ?? {}),
      now,
      now,
    );
}

function materializeL1Lifecycle(
  database: TaskcraftDatabase,
  taskId: string,
  input: TaskNewInput,
  actor: string,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO lifecycle_revisions (
         task_id, revision, reason_code, reason, compiler_version,
         facts_digest, policy_digest, change_summary_json, created_by,
         created_at
       ) VALUES (?, 1, 'initial', 'initial L1 lifecycle', 'tc-l1/1', ?, ?,
         '{}', ?, ?)`,
    )
    .run(taskId, L1_FACTS_DIGEST, L1_POLICY_DIGEST, actor, now);

  const objective = input.objectiveMd ?? input.title;
  const insertNode = database.prepare(
    `INSERT INTO lifecycle_nodes (
       task_id, lifecycle_revision, id, kind, title, objective,
       procedure_ref, scope_json, entry_gate_json, exit_gate_json,
       retry_policy_json, input_schema_json, output_schema_json
     ) VALUES (?, 1, ?, ?, ?, ?, ?, '{}', '{}', '{}', ?, '{}', ?)`,
  );
  insertNode.run(
    taskId,
    L1_EXECUTE_NODE_ID,
    "execute",
    "Execute",
    objective,
    "l1:execute",
    JSON.stringify(L1_RETRY_POLICY),
    JSON.stringify(L1_EXECUTE_RESULT_SCHEMA),
  );
  insertNode.run(
    taskId,
    L1_RECORD_NODE_ID,
    "record",
    "Record",
    objective,
    "l1:record",
    JSON.stringify(L1_RETRY_POLICY),
    JSON.stringify(L1_RECORD_RESULT_SCHEMA),
  );

  database
    .prepare(
      `INSERT INTO lifecycle_edges (
         task_id, lifecycle_revision, from_node_id, to_node_id,
         condition_json, label
       ) VALUES (?, 1, 'execute-1', 'record-1', '{"kind":"always"}', NULL)`,
    )
    .run(taskId);

  const insertObligation = database.prepare(
    `INSERT INTO obligation_definitions (
       task_id, lifecycle_revision, node_id, id, duty, title, evaluator_json
     ) VALUES (?, 1, ?, ?, 'required', ?, ?)`,
  );
  for (const obligation of L1_OBLIGATIONS) {
    insertObligation.run(
      taskId,
      obligation.nodeId,
      obligation.id,
      obligation.title,
      obligation.evaluatorJson,
    );
  }
}
