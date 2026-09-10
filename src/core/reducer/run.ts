// run: activates a queued task and claims the execute-1 attempt in one
// transaction. On an already-activated task it claims the target node
// attempt (creating a successor when none is active) and returns the Node
// Brief; repeating run on an active attempt writes nothing. Any runnable
// node of the current revision can be claimed (record-1 too, so a missing
// record segment can be submitted without redoing the execute work).

import type { TaskcraftDatabase } from "../../store/database.js";
import { getAttempts } from "../../store/query.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_DEFAULT_ACTOR, L1_EXECUTE_NODE_ID } from "../lifecycle/l1.js";
import { project } from "../projector.js";
import type { CommandData, RunInput } from "./context.js";
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
import { buildNodeBrief } from "../node-brief-query.js";

export function run(
  database: TaskcraftDatabase,
  taskId: string,
  input: RunInput = {},
): CommandData {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);
    const nodeId = input.nodeId ?? L1_EXECUTE_NODE_ID;
    const nodeProjection = project(database, taskId).nodeStatuses.find(
      (node) => node.nodeId === nodeId,
    );

    if (nodeProjection === undefined || nodeProjection.status === "blocked") {
      throw new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
        problem:
          nodeProjection === undefined
            ? `Node ${nodeId} does not exist in the current lifecycle revision`
            : `Node ${nodeId} is not runnable yet: its predecessors are not satisfied`,
        impact: "No facts were written",
        remediation: "List runnable nodes with: tc task next <task-id> --json",
        context: { taskId, nodeId },
      });
    }

    if (nodeProjection.kind === "review") {
      // Review attempts only exist through reviewStart, which writes the
      // review link in the same transaction; a bare run would leave a
      // link-less review attempt the projector cannot resolve.
      throw new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
        problem: `Node ${nodeId} is a review node; review attempts are opened with review start`,
        impact: "No facts were written",
        remediation: `Start the review with: tc review start <task-id> --node ${nodeId} --purpose <feasibility|delivery|integration>`,
        context: { taskId, nodeId },
      });
    }

    if (nodeProjection.status === "satisfied") {
      throw new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
        problem: `Node ${nodeId} is already satisfied; no new attempt can be claimed`,
        impact: "No facts were written",
        remediation: "Follow the projected next command from: tc status --json",
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
      // Attempt numbers advance per node across every lifecycle revision:
      // node_attempts.id is a global primary key, so a replanned revision
      // must not reuse the ids of superseded revision-1 attempts.
      const nextNumber =
        getAttempts(database, taskId)
          .filter((attempt) => attempt.nodeId === nodeId)
          .reduce((max, attempt) => Math.max(max, attempt.attemptNumber), 0) +
        1;
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

    const currentSnapshot = snapshotOf(database, taskId);
    const data = commandData(database, taskId, currentSnapshot);
    return {
      ...data,
      nodeBrief: buildNodeBrief(
        database,
        taskId,
        currentSnapshot,
        claimedAttemptId,
        nodeId,
      ),
    };
  });
}
