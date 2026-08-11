// run: activates a queued task and claims the execute-1 attempt in one
// transaction. On an already-activated task it claims the target node
// attempt (creating a successor when none is active) and returns the Node
// Brief; repeating run on an active attempt writes nothing.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getAttempts, getLifecycle } from "../../store/query.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_DEFAULT_ACTOR, L1_EXECUTE_NODE_ID } from "../lifecycle/l1.js";
import type { CommandData, NodeBrief, RunInput } from "./context.js";
import {
  assertNotCancelled,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import {
  activateTask,
  attemptId,
  bumpRevision,
  insertAttempt,
  insertEvent,
  nowIso,
} from "./shared.js";

export function run(
  database: TaskcraftDatabase,
  taskId: string,
  input: RunInput = {},
): CommandData {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);
    const nodeId = input.nodeId ?? L1_EXECUTE_NODE_ID;

    if (nodeId !== L1_EXECUTE_NODE_ID) {
      throw new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
        problem: `L1 node ${nodeId} has no runnable attempt; only execute-1 can be claimed`,
        impact: "No facts were written",
        remediation:
          "The record result is submitted with: tc run complete <task-id>",
        context: { taskId, nodeId },
      });
    }

    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const host = input.host ?? L1_DEFAULT_ACTOR;
    const now = nowIso();
    const attempts = getAttempts(database, taskId).filter(
      (attempt) =>
        attempt.lifecycleRevision === snapshot.currentLifecycleRevision,
    );
    const activeAttempt = attempts.find(
      (attempt) =>
        attempt.nodeId === nodeId &&
        (attempt.status === "created" || attempt.status === "running"),
    );

    let claimedAttemptId: string;

    if (snapshot.activatedAt === null) {
      const attempt = attemptId(taskId, nodeId, 1);
      claimedAttemptId = attempt;
      activateTask(database, snapshot, now);
      insertAttempt(database, {
        id: attempt,
        taskId,
        lifecycleRevision: snapshot.currentLifecycleRevision,
        nodeId,
        attemptNumber: 1,
        actorInstanceId: actor,
        host,
        status: "created",
        outcome: null,
        resultJson: null,
        startedAt: null,
        finishedAt: null,
      });
      insertEvent(database, {
        taskId,
        lifecycleRevision: snapshot.currentLifecycleRevision,
        nodeId,
        attemptId: attempt,
        eventType: "task.activated",
        payload: {},
        postTaskRevision: snapshot.revision + 1,
        actorInstanceId: actor,
        host,
        occurredAt: now,
      });
      bumpRevision(database, snapshot, now);
    } else if (activeAttempt === undefined) {
      const nextNumber =
        attempts.reduce(
          (max, attempt) => Math.max(max, attempt.attemptNumber),
          0,
        ) + 1;
      const attempt = attemptId(taskId, nodeId, nextNumber);
      claimedAttemptId = attempt;
      insertAttempt(database, {
        id: attempt,
        taskId,
        lifecycleRevision: snapshot.currentLifecycleRevision,
        nodeId,
        attemptNumber: nextNumber,
        actorInstanceId: actor,
        host,
        status: "created",
        outcome: null,
        resultJson: null,
        startedAt: null,
        finishedAt: null,
      });
      insertEvent(database, {
        taskId,
        lifecycleRevision: snapshot.currentLifecycleRevision,
        nodeId,
        attemptId: attempt,
        eventType: "attempt.created",
        payload: {},
        postTaskRevision: snapshot.revision + 1,
        actorInstanceId: actor,
        host,
        occurredAt: now,
      });
      bumpRevision(database, snapshot, now);
    } else {
      claimedAttemptId = activeAttempt.id;
    }

    const data = commandData(database, taskId, snapshotOf(database, taskId));
    return {
      ...data,
      nodeBrief: nodeBrief(database, taskId, snapshot, claimedAttemptId),
    };
  });
}

/** Node Brief for execute-1: objective, obligations, result schema and the
 * registered completion command, all read from the current revision. */
function nodeBrief(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: { title: string; currentLifecycleRevision: number },
  claimedAttemptId: string,
): NodeBrief {
  const graph = getLifecycle(
    database,
    taskId,
    snapshot.currentLifecycleRevision,
  );
  const node = graph.nodes.find(
    (candidate) => candidate.id === L1_EXECUTE_NODE_ID,
  )!;

  return {
    taskId,
    taskTitle: snapshot.title,
    nodeId: node.id,
    nodeKind: node.kind,
    attemptId: claimedAttemptId,
    objective: node.objective,
    procedureRef: node.procedureRef,
    obligations: graph.obligations
      .filter((obligation) => obligation.nodeId === L1_EXECUTE_NODE_ID)
      .map((obligation) => ({
        id: obligation.id,
        duty: obligation.duty,
        title: obligation.title,
      })),
    resultSchemaJson: node.outputSchemaJson,
    nextCommand: `tc run complete ${taskId}`,
  };
}
