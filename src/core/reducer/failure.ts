// Failure and retry attempt semantics: runFail marks an attempt failed and,
// when the retry budget of the node is exhausted (L1 default: 3 consecutive
// failures), opens an open failed_retries_exhausted blocker so the projector
// derives waiting. runRetry creates a successor attempt for the same node
// (attempt numbers advance globally across revisions) or opens the
// exhaustion blocker when the budget is already spent. Both run inside
// withTransaction + checkRevision with contiguous audit events.

import type { TaskcraftDatabase } from "../../store/database.js";
import {
  getAgentRuns,
  getAttempts,
  getLifecycle,
  getOpenBlockers,
} from "../../store/query.js";
import type { AttemptRow } from "../../store/query.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_DEFAULT_ACTOR, L1_RETRY_POLICY } from "../lifecycle/l1.js";
import type {
  AttemptFailureInput,
  CommandData,
  RunRetryInput,
} from "./context.js";
import {
  assertNotCancelled,
  attemptRefError,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import {
  attemptId,
  bumpRevision,
  insertAttempt,
  insertEvent,
  nowIso,
} from "./shared.js";
import { buildNodeBrief } from "./node-brief.js";

export interface RetryResult extends CommandData {
  /** Successor attempt id, or null when the retry budget was exhausted and
   * an open blocker was written instead of a successor. */
  successorAttemptId: string | null;
}

export function runFail(
  database: TaskcraftDatabase,
  taskId: string,
  input: AttemptFailureInput,
): CommandData {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);
    const attempt = findCurrentAttempt(
      database,
      taskId,
      snapshot,
      input.attemptId,
    );

    if (attempt.status !== "created" && attempt.status !== "running") {
      throw attemptRefError(
        taskId,
        `Attempt ${input.attemptId} is not an active attempt of the current revision`,
        "Claim an attempt first with: tc run <task-id> --node <node-id>",
      );
    }

    const now = nowIso();
    database
      .prepare(
        `UPDATE node_attempts SET status = 'failed', outcome = 'failed',
                finished_at = ? WHERE id = ?`,
      )
      .run(now, attempt.id);

    if (
      failedAttempts(database, taskId, snapshot, attempt.nodeId).length >=
      retryBudget(database, taskId, snapshot, attempt.nodeId)
    ) {
      writeExhaustionBlocker(
        database,
        taskId,
        snapshot,
        attempt,
        input.reason,
        now,
      );
    }

    insertEvent(database, {
      taskId,
      lifecycleRevision: snapshot.currentLifecycleRevision,
      nodeId: attempt.nodeId,
      attemptId: attempt.id,
      eventType: "attempt.failed",
      payload: { reason: input.reason },
      postTaskRevision: snapshot.revision + 1,
      actorInstanceId: input.actorInstanceId ?? L1_DEFAULT_ACTOR,
      host: attempt.host,
      occurredAt: now,
    });
    bumpRevision(database, snapshot, now);

    return commandData(database, taskId, snapshotOf(database, taskId));
  });
}

export function runRetry(
  database: TaskcraftDatabase,
  taskId: string,
  input: RunRetryInput,
): RetryResult {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);

    if (input.reason.trim() === "") {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
        problem: "A retry requires a non-empty --reason",
        impact: "No facts were written",
        remediation: "Explain why the attempt is retried",
        context: { taskId, attemptId: input.attemptId },
      });
    }

    const attempt = findCurrentAttempt(
      database,
      taskId,
      snapshot,
      input.attemptId,
    );
    assertLatestNodeAttempt(database, taskId, snapshot, attempt);
    const staleObservation = hasStaleObservation(database, taskId, attempt);
    const retryable =
      attempt.status === "failed" ||
      attempt.status === "superseded" ||
      staleObservation;

    if (!retryable) {
      throw attemptRefError(
        taskId,
        `Attempt ${input.attemptId} is not failed/superseded and its host observation is not stale`,
        "Fail the attempt first with: tc run fail <task-id> --attempt <attempt-id> --reason <text>",
      );
    }

    const revision = snapshot.currentLifecycleRevision;
    const budget = retryBudget(database, taskId, snapshot, attempt.nodeId);
    const failedCount = failedAttempts(
      database,
      taskId,
      snapshot,
      attempt.nodeId,
    ).length;
    const openBlockers = getOpenBlockers(database, taskId);

    // A waiting task cannot be retried: an open blocker pauses the loop on an
    // external answer (or on the spent budget), and a successor attempt would
    // win over the blocker in the projector and leave a zombie open blocker
    // next to an active task. The exhausted blocker keeps its own code; any
    // other blocker must be resolved first.
    if (
      openBlockers.some(
        (blocker) => blocker.waitingReason === "failed_retries_exhausted",
      )
    ) {
      throw new TaskcraftError(ERROR_CODES.TC_RETRY_BUDGET_EXHAUSTED, {
        problem: `Attempt ${attempt.id} cannot be retried: the retry budget of node ${attempt.nodeId} is exhausted (${budget} failures)`,
        impact: "No facts were written; the task stays waiting",
        remediation: `Override the blocker with: tc task resume ${taskId} --resolve, or cancel with: tc task cancel ${taskId} --reason <reason>`,
        context: { taskId, attemptId: attempt.id, budget },
      });
    }

    if (openBlockers.length > 0) {
      throw new TaskcraftError(ERROR_CODES.TC_BLOCKER_UNRESOLVED, {
        problem: `Task ${taskId} is waiting on blocker ${openBlockers[0]!.id} (${openBlockers[0]!.waitingReason}); an attempt cannot be retried while the task waits`,
        impact: "No facts were written; the task stays waiting",
        remediation: `Resolve the blocker first with: ${openBlockers[0]!.remediationCommand ?? `tc task resume ${taskId} --resolve`}`,
        context: {
          taskId,
          attemptId: attempt.id,
          blockerId: openBlockers[0]!.id,
        },
      });
    }

    if (failedCount >= budget) {
      const now = nowIso();
      writeExhaustionBlocker(
        database,
        taskId,
        snapshot,
        attempt,
        input.reason,
        now,
      );
      insertEvent(database, {
        taskId,
        lifecycleRevision: revision,
        nodeId: attempt.nodeId,
        attemptId: attempt.id,
        eventType: "task.waiting",
        payload: {
          waitingReason: "failed_retries_exhausted",
          reason: input.reason,
        },
        postTaskRevision: snapshot.revision + 1,
        actorInstanceId: input.actorInstanceId ?? L1_DEFAULT_ACTOR,
        host: attempt.host,
        occurredAt: now,
      });
      bumpRevision(database, snapshot, now);

      return {
        ...commandData(database, taskId, snapshotOf(database, taskId)),
        successorAttemptId: null,
      };
    }

    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const now = nowIso();
    if (staleObservation) {
      database
        .prepare(
          `UPDATE node_attempts
             SET status = 'superseded', outcome = 'superseded', finished_at = ?
           WHERE id = ?`,
        )
        .run(now, attempt.id);
    }

    // Successor numbers advance per node across every lifecycle revision:
    // node_attempts.id is a global primary key, so a replanned revision must
    // not reuse the ids of superseded revision-1 attempts.
    const successorNumber =
      getAttempts(database, taskId)
        .filter((candidate) => candidate.nodeId === attempt.nodeId)
        .reduce((max, candidate) => Math.max(max, candidate.attemptNumber), 0) +
      1;
    const successorAttempt = attemptId(taskId, attempt.nodeId, successorNumber);

    insertAttempt(database, {
      id: successorAttempt,
      taskId,
      lifecycleRevision: revision,
      nodeId: attempt.nodeId,
      attemptNumber: successorNumber,
      actorInstanceId: actor,
      host: attempt.host,
      status: "created",
      outcome: null,
      resultJson: null,
      startedAt: null,
      finishedAt: null,
    });
    insertEvent(database, {
      taskId,
      lifecycleRevision: revision,
      nodeId: attempt.nodeId,
      attemptId: attempt.id,
      eventType: "attempt.retried",
      payload: { reason: input.reason, successorAttemptId: successorAttempt },
      postTaskRevision: snapshot.revision + 1,
      actorInstanceId: actor,
      host: attempt.host,
      occurredAt: now,
    });
    bumpRevision(database, snapshot, now);

    const currentSnapshot = snapshotOf(database, taskId);
    return {
      ...commandData(database, taskId, currentSnapshot),
      successorAttemptId: successorAttempt,
      nodeBrief: buildNodeBrief(
        database,
        taskId,
        currentSnapshot,
        successorAttempt,
        attempt.nodeId,
      ),
    };
  });
}

/** Resolves the named attempt of the current lifecycle revision or throws
 * the stable reference error (never null after validation). */
function findCurrentAttempt(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: { currentLifecycleRevision: number },
  attemptId: string,
): AttemptRow {
  const attempt = getAttempts(database, taskId).find(
    (candidate) => candidate.id === attemptId,
  );

  if (
    attempt === undefined ||
    attempt.taskId !== taskId ||
    attempt.lifecycleRevision !== snapshot.currentLifecycleRevision
  ) {
    throw attemptRefError(
      taskId,
      `Attempt ${attemptId} is not an attempt of the current lifecycle revision`,
      "Pass the attempt id from: tc task show <task-id> --json",
    );
  }

  return attempt;
}

/** Retry only advances the latest attempt of a node. Retrying an older
 * failed/superseded id after a successor exists would create two active
 * successors or reopen a node that already completed. */
function assertLatestNodeAttempt(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: { currentLifecycleRevision: number },
  attempt: AttemptRow,
): void {
  const latest = getAttempts(database, taskId)
    .filter(
      (candidate) =>
        candidate.lifecycleRevision === snapshot.currentLifecycleRevision &&
        candidate.nodeId === attempt.nodeId,
    )
    .reduce<AttemptRow | undefined>(
      (current, candidate) =>
        current === undefined || candidate.attemptNumber > current.attemptNumber
          ? candidate
          : current,
      undefined,
    );

  if (latest?.id !== attempt.id) {
    throw attemptRefError(
      taskId,
      `Attempt ${attempt.id} is not the latest attempt of node ${attempt.nodeId}`,
      `Retry the latest attempt instead: ${latest?.id ?? "tc task show <task-id> --json"}`,
    );
  }
}

/** A created/running attempt whose latest host observation is stale can be
 * retried without a recorded failure (the host died mid-run). */
function hasStaleObservation(
  database: TaskcraftDatabase,
  taskId: string,
  attempt: AttemptRow,
): boolean {
  if (attempt.status !== "created" && attempt.status !== "running") {
    return false;
  }

  return getAgentRuns(database, taskId).some(
    (run) =>
      run.nodeAttemptId === attempt.id && run.observationStatus === "stale",
  );
}

function failedAttempts(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: { currentLifecycleRevision: number },
  nodeId: string,
): AttemptRow[] {
  return getAttempts(database, taskId).filter(
    (candidate) =>
      candidate.lifecycleRevision === snapshot.currentLifecycleRevision &&
      candidate.nodeId === nodeId &&
      candidate.outcome === "failed",
  );
}

/** Retry budget from the node's retry_policy_json; falls back to the L1
 * default (3) when the policy is absent or not parseable. */
function retryBudget(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: { currentLifecycleRevision: number },
  nodeId: string,
): number {
  const node = getLifecycle(
    database,
    taskId,
    snapshot.currentLifecycleRevision,
  ).nodes.find((candidate) => candidate.id === nodeId);

  if (node !== undefined) {
    try {
      const policy = JSON.parse(node.retryPolicyJson) as {
        maxRetries?: unknown;
      };

      if (
        typeof policy.maxRetries === "number" &&
        Number.isInteger(policy.maxRetries) &&
        policy.maxRetries > 0
      ) {
        return policy.maxRetries;
      }
    } catch {
      // fall through to the default budget
    }
  }

  return L1_RETRY_POLICY.maxRetries;
}

function writeExhaustionBlocker(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: { currentLifecycleRevision: number },
  attempt: AttemptRow,
  reason: string,
  now: string,
): void {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM blockers WHERE task_id = ?")
    .get(taskId) as { count: number };

  database
    .prepare(
      `INSERT INTO blockers (
         id, task_id, lifecycle_revision, node_id, kind, waiting_reason,
         status, reason, remediation_command, created_at, resolved_at
       ) VALUES (?, ?, ?, ?, 'evidence', 'failed_retries_exhausted',
         'open', ?, ?, ?, NULL)`,
    )
    .run(
      `blk-${taskId}-${row.count + 1}`,
      taskId,
      snapshot.currentLifecycleRevision,
      attempt.nodeId,
      reason,
      `tc task resume ${taskId} --resolve`,
      now,
    );
}
