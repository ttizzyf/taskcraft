// taskNew: creates the task row (revision 1), materializes the L1 or L2
// lifecycle into the four definition tables and appends the task.created
// audit event. No activation facts are written; the task projects as queued.

import type { TaskcraftDatabase } from "../../store/database.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import {
  L1_DEFAULT_ACTOR,
  L1_FACTS_DIGEST,
  L1_POLICY_DIGEST,
} from "../lifecycle/l1.js";
import { L2_COMPILER_VERSION } from "../lifecycle/l2.js";
import {
  L3_COMPILER_VERSION,
  L3_FACTS_DIGEST,
  L3_POLICY_DIGEST,
} from "../lifecycle/l3.js";
import type { CommandData, TaskNewInput } from "./context.js";
import { commandData, snapshotOf } from "./context.js";
import { materializeL2Graph } from "./l2-materialize.js";
import { materializeL3Graph } from "./l3-materialize.js";
import { materializeL1Graph } from "./l1-materialize.js";
import { insertLifecycleSpecBindings } from "../../store/spec-facts.js";
import { assertResolvedBindings } from "../../spec/bindings.js";
import { insertEvent, isUniqueConstraint, nowIso } from "./shared.js";
import { allocateTaskId, insertTaskRow } from "./task-row.js";

export function taskNew(
  database: TaskcraftDatabase,
  input: TaskNewInput,
): CommandData {
  return withTransaction(database, () => {
    validateTaskNewInput(input);
    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const now = nowIso();
    let taskId = allocateTaskId(database);

    try {
      insertPublicTaskRow(database, taskId, input, now);
    } catch (cause) {
      if (!isUniqueConstraint(cause)) {
        throw cause;
      }

      taskId = allocateTaskId(database);
      insertPublicTaskRow(database, taskId, input, now);
    }

    if (input.level === 3) {
      materializeL3Graph(database, {
        taskId,
        revision: 1,
        reasonCode: "initial",
        reason: "initial L3 lifecycle",
        compilerVersion: L3_COMPILER_VERSION,
        factsDigest: L3_FACTS_DIGEST,
        policyDigest: L3_POLICY_DIGEST,
        changeSummary: {},
        objective: input.objectiveMd ?? input.title,
        actor,
        now,
      });
    } else if (input.level === 2) {
      materializeL2Graph(database, {
        taskId,
        revision: 1,
        reasonCode: "initial",
        reason: "initial L2 lifecycle",
        compilerVersion: L2_COMPILER_VERSION,
        factsDigest: L1_FACTS_DIGEST,
        policyDigest: L1_POLICY_DIGEST,
        changeSummary: {},
        objective: input.objectiveMd ?? input.title,
        actor,
        now,
      });
    } else {
      materializeL1Graph(database, {
        taskId,
        revision: 1,
        reasonCode: "initial",
        reason: "initial L1 lifecycle",
        changeSummary: {},
        objective: input.objectiveMd ?? input.title,
        actor,
        now,
      });
    }

    insertInitialSpecBindings(database, taskId, input, actor, now);

    insertEvent(database, {
      taskId,
      lifecycleRevision: 1,
      nodeId: null,
      attemptId: null,
      eventType: "task.created",
      payload: { level: input.level, reason: input.reason },
      postTaskRevision: 1,
      actorInstanceId: actor,
      host: null,
      occurredAt: now,
    });

    return commandData(database, taskId, snapshotOf(database, taskId));
  });
}

function validateTaskNewInput(input: TaskNewInput): void {
  if (input.level !== 1 && input.level !== 2 && input.level !== 3) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_LEVEL_UNSUPPORTED, {
      problem: `Level ${input.level} is not supported yet: only L1, L2 and L3 are available`,
      impact: "The task was not created; the lifecycle graph is not compiled",
      remediation: "Create an L1, L2 or L3 task",
      context: { level: input.level },
    });
  }

  assertResolvedBindings(
    input.initialSpecBindings ?? [],
    "Initial Spec bindings",
  );

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

function insertPublicTaskRow(
  database: TaskcraftDatabase,
  taskId: string,
  input: TaskNewInput,
  now: string,
): void {
  insertTaskRow(
    database,
    taskId,
    {
      title: input.title,
      level: input.level as 1 | 2 | 3,
      objectiveMd: input.objectiveMd ?? input.title,
      scope: {},
      acceptance: [],
      nonGoals: [],
      classificationFacts: input.classificationFacts,
    },
    now,
  );
}

function insertInitialSpecBindings(
  database: TaskcraftDatabase,
  taskId: string,
  input: TaskNewInput,
  actor: string,
  now: string,
): void {
  const nodeIds =
    input.level === 1
      ? ["execute-1", "record-1"]
      : input.level === 2
        ? ["frame-1"]
        : ["frame-1", "plan-1", "review-plan-1"];
  insertLifecycleSpecBindings(database, {
    taskId,
    lifecycleRevision: 1,
    nodeIds,
    bindings: input.initialSpecBindings ?? [],
    source: { kind: "task_create" },
    actor,
    now,
  });
}
