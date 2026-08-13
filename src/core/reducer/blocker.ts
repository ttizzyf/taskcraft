// taskWait / taskResume: the typed waiting loop. taskWait opens one blocker
// (kind and waiting_reason derived from the reason code), ends the running
// attempts of the current revision so the projector derives waiting (a
// running attempt always wins over a blocker), and appends the task.waiting
// audit event. taskResume resolves the earliest open blocker when the user
// answered -- a constraint fact written after the blocker opened -- or when
// the caller overrides with resolve: true, then appends task.resumed. Both
// run inside withTransaction + checkRevision, so the blocker open/resolve is
// atomic with its event and the revision bump (CAS).

import type { TaskcraftDatabase } from "../../store/database.js";
import {
  getAttempts,
  getLifecycle,
  getOpenBlockers,
  getTaskFacts,
} from "../../store/query.js";
import type { BlockerRow, TaskFactRow } from "../../store/query.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import { project } from "../projector.js";
import type {
  CommandData,
  TaskResumeInput,
  TaskWaitInput,
  WaitingReasonCode,
} from "./context.js";
import {
  assertNotCancelled,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import { bumpRevision, insertEvent, nowIso } from "./shared.js";

const WAITING_REASON_CODES: readonly WaitingReasonCode[] = Object.freeze([
  "needs_input",
  "needs_decision",
  "blocked_dependency",
]);

/** blockers.kind by reason code; the waiting_reason is the code itself. */
const BLOCKER_KIND_BY_REASON: Readonly<
  Record<WaitingReasonCode, "dependency" | "needs_input" | "needs_decision">
> = {
  needs_input: "needs_input",
  needs_decision: "needs_decision",
  blocked_dependency: "dependency",
};

export function taskWait(
  database: TaskcraftDatabase,
  taskId: string,
  input: TaskWaitInput,
): CommandData {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);

    if (snapshot.activatedAt === null) {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_NOT_ACTIVATED, {
        problem: `Task ${taskId} is not activated yet; waiting requires an active task`,
        impact: "No facts were written",
        remediation: `Activate the task first with: tc run ${taskId}`,
        context: { taskId },
      });
    }

    if (!WAITING_REASON_CODES.includes(input.reasonCode)) {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
        problem: `--reason must be one of ${WAITING_REASON_CODES.join(", ")}, got: ${input.reasonCode}`,
        impact: "No facts were written",
        remediation: "Retry with a valid waiting reason code",
        context: { taskId, reasonCode: input.reasonCode },
      });
    }

    if (input.message.trim() === "") {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
        problem: "A wait requires a non-empty --message",
        impact: "No facts were written",
        remediation: "Describe what the task is waiting for",
        context: { taskId },
      });
    }

    if (getOpenBlockers(database, taskId).length > 0) {
      throw new TaskcraftError(ERROR_CODES.TC_BLOCKER_ALREADY_OPEN, {
        problem: `Task ${taskId} already has an open blocker; a task waits on at most one blocker at a time`,
        impact: "No facts were written",
        remediation: `Resolve the existing blocker with: tc task resume ${taskId} --resolve`,
        context: { taskId },
      });
    }

    const revision = snapshot.currentLifecycleRevision;
    const graph = getLifecycle(database, taskId, revision);
    const nodeId = resolveBlockedNode(database, taskId, graph, input);
    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const now = nowIso();
    const endedAttemptIds = endRunningAttempts(database, taskId, revision, now);
    const blockerId = nextBlockerId(database, taskId);

    database
      .prepare(
        `INSERT INTO blockers (
           id, task_id, lifecycle_revision, node_id, kind, waiting_reason,
           status, reason, remediation_command, created_at, resolved_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, NULL)`,
      )
      .run(
        blockerId,
        taskId,
        revision,
        nodeId,
        BLOCKER_KIND_BY_REASON[input.reasonCode],
        input.reasonCode,
        input.message,
        `tc task resume ${taskId}`,
        now,
      );

    insertEvent(database, {
      taskId,
      lifecycleRevision: revision,
      nodeId,
      attemptId: null,
      eventType: "task.waiting",
      payload: {
        waitingReason: input.reasonCode,
        message: input.message,
        endedAttemptIds,
      },
      postTaskRevision: snapshot.revision + 1,
      actorInstanceId: actor,
      host: null,
      occurredAt: now,
    });
    bumpRevision(database, snapshot, now);

    return commandData(database, taskId, snapshotOf(database, taskId));
  });
}

export function taskResume(
  database: TaskcraftDatabase,
  taskId: string,
  input: TaskResumeInput,
): CommandData {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);
    const blocker = getOpenBlockers(database, taskId)[0];

    if (blocker === undefined) {
      throw new TaskcraftError(ERROR_CODES.TC_BLOCKER_UNRESOLVED, {
        problem: `Task ${taskId} has no open blocker; there is nothing to resume`,
        impact: "The task state was not changed",
        remediation: `Inspect the task with: tc task show ${taskId} --json`,
        context: { taskId },
      });
    }

    if (
      input.resolve !== true &&
      !hasSatisfyingFact(database, taskId, blocker)
    ) {
      throw new TaskcraftError(ERROR_CODES.TC_BLOCKER_UNRESOLVED, {
        problem: `Blocker ${blocker.id} (${blocker.waitingReason}) has no satisfying fact`,
        impact: "The blocker stays open; the task remains waiting",
        remediation: `Record the user answer as a constraint fact with: tc task fact add ${taskId} --attempt <attempt-id> --category constraint --subject <subject> --value <json>, or override with: tc task resume ${taskId} --resolve`,
        context: { taskId, blockerId: blocker.id },
      });
    }

    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const now = nowIso();

    database
      .prepare(
        "UPDATE blockers SET status = 'resolved', resolved_at = ? WHERE id = ?",
      )
      .run(now, blocker.id);

    insertEvent(database, {
      taskId,
      lifecycleRevision: snapshot.currentLifecycleRevision,
      nodeId: blocker.nodeId,
      attemptId: null,
      eventType: "task.resumed",
      payload: {
        blockerId: blocker.id,
        waitingReason: blocker.waitingReason,
        resolve: input.resolve === true,
      },
      postTaskRevision: snapshot.revision + 1,
      actorInstanceId: actor,
      host: null,
      occurredAt: now,
    });
    bumpRevision(database, snapshot, now);

    return commandData(database, taskId, snapshotOf(database, taskId));
  });
}

/** Node the blocker attaches to: the caller's --node when given (validated
 * against the current revision graph), otherwise the running node or the
 * first runnable node of the current projection. */
function resolveBlockedNode(
  database: TaskcraftDatabase,
  taskId: string,
  graph: ReturnType<typeof getLifecycle>,
  input: TaskWaitInput,
): string {
  if (input.nodeId !== undefined) {
    if (!graph.nodes.some((node) => node.id === input.nodeId)) {
      throw new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
        problem: `Node ${input.nodeId} does not exist in the current lifecycle revision`,
        impact: "No facts were written",
        remediation: "List runnable nodes with: tc task next <task-id> --json",
        context: { taskId, nodeId: input.nodeId },
      });
    }

    return input.nodeId;
  }

  const projection = project(database, taskId);
  const nodeId = projection.runningNode ?? projection.runnableNodes[0] ?? null;

  if (nodeId === null) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
      problem: `Task ${taskId} has no running or runnable node to block`,
      impact: "No facts were written",
      remediation: `Pass the node explicitly with: tc task wait ${taskId} --reason <code> --message <text> --node <node-id>`,
      context: { taskId },
    });
  }

  return nodeId;
}

/** Ends created/running attempts of the current revision (failed/blocked) so
 * the projector derives waiting; returns the ended attempt ids for the audit
 * event. A blocker cannot win over a running attempt in the projector. */
function endRunningAttempts(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
  now: string,
): string[] {
  const ended: string[] = [];
  const active = getAttempts(database, taskId).filter(
    (attempt) =>
      attempt.lifecycleRevision === revision &&
      (attempt.status === "created" || attempt.status === "running"),
  );

  for (const attempt of active) {
    database
      .prepare(
        `UPDATE node_attempts SET status = 'failed', outcome = 'blocked',
                finished_at = ? WHERE id = ?`,
      )
      .run(now, attempt.id);
    ended.push(attempt.id);
  }

  return ended;
}

/** Decidable satisfaction rule: a constraint fact written at or after the
 * blocker opened counts as the user answer (lifecycle spec 7.2/9.1). */
function hasSatisfyingFact(
  database: TaskcraftDatabase,
  taskId: string,
  blocker: BlockerRow,
): boolean {
  return getTaskFacts(database, taskId).some(
    (fact: TaskFactRow) =>
      fact.category === "constraint" && fact.createdAt >= blocker.createdAt,
  );
}

function nextBlockerId(database: TaskcraftDatabase, taskId: string): string {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM blockers WHERE task_id = ?")
    .get(taskId) as { count: number };

  return `blk-${taskId}-${row.count + 1}`;
}
