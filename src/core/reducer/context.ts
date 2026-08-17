// Shared command context: public result/input types and the CAS/reference
// plumbing every reducer command starts with. Kept separate from the
// low-level write helpers so command files stay small.

import { ERROR_CODES, TaskcraftError } from "../errors.js";
import type { TaskcraftDatabase } from "../../store/database.js";
import { getTask } from "../../store/query.js";
import type {
  BlockerWaitingReason,
  NodeKind,
  ObligationDuty,
} from "../../store/query.js";
import { checkRevision } from "../../store/revision-guard.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import { project } from "../projector.js";
import type { ProjectStatus } from "../projector.js";

export interface CommandData {
  taskId: string;
  taskRevision: number;
  status: ProjectStatus;
  waitingReason: BlockerWaitingReason | null;
  next: string | null;
  nodeBrief?: NodeBrief;
}

export interface NodeBrief {
  taskId: string;
  taskTitle: string;
  nodeId: string;
  nodeKind: NodeKind;
  attemptId: string;
  objective: string;
  procedureRef: string;
  obligations: Array<{ id: string; duty: ObligationDuty; title: string }>;
  resultSchemaJson: string;
  nextCommand: string;
}

export interface TaskNewInput {
  title: string;
  level: number;
  reason: string;
  objectiveMd?: string;
  /** Classification facts persisted verbatim as JSON (must be a plain
   * object); absent means an empty fact set. */
  classificationFacts?: unknown;
  actorInstanceId?: string;
}

export interface RunInput {
  expectedRevision?: number;
  nodeId?: string;
  host?: string;
  actorInstanceId?: string;
}

export interface RunCompleteInput {
  result: unknown;
  /** Target node of the result (default execute-1); record-1 completes the
   * record node when the execute result carried no record segment. */
  nodeId?: string;
  attemptId?: string;
  expectedRevision?: number;
  actorInstanceId?: string;
}

export interface CancelInput {
  reason: string;
  expectedRevision?: number;
  actorInstanceId?: string;
}

export interface AttemptFailureInput {
  attemptId: string;
  reason: string;
  expectedRevision?: number;
  actorInstanceId?: string;
}

export interface RunRetryInput {
  attemptId: string;
  reason: string;
  expectedRevision?: number;
  actorInstanceId?: string;
}

/** Typed waiting reasons a task can block on (lifecycle spec 8). */
export type WaitingReasonCode =
  "needs_input" | "needs_decision" | "blocked_dependency";

export interface TaskWaitInput {
  expectedRevision?: number;
  reasonCode: WaitingReasonCode;
  /** What the task is waiting for; stored as the blocker reason. */
  message: string;
  /** Node the blocker attaches to (default: the running node or the first
   * runnable node of the current projection). */
  nodeId?: string;
  actorInstanceId?: string;
}

export interface TaskResumeInput {
  expectedRevision?: number;
  /** Resolves the open blocker without requiring a satisfying constraint
   * fact (human override; also the escape hatch for a spent retry budget). */
  resolve?: boolean;
  actorInstanceId?: string;
}

export interface ReviewStartInput {
  taskId: string;
  expectedRevision?: number;
  /** Review node of the current revision (default review-1). */
  nodeId?: string;
  purpose: "feasibility" | "delivery" | "integration";
  /** Reviewed attempt of the current revision (default: the latest
   * finished/success attempt of the node kind matching the purpose). */
  reviewedAttemptId?: string;
  capability: "context-only" | "manual-attach" | "host-observed";
  independenceStatus:
    "observed-distinct" | "unverified" | "same-actor" | "unsupported";
  host?: string;
  observedHostSessionId?: string;
  actorInstanceId?: string;
}

export interface ReviewPassInput {
  taskId: string;
  expectedRevision?: number;
  attemptId: string;
  reviewedAttemptId: string;
  evidence: Array<{
    type: "validation" | "test" | "artifact" | "note";
    reference: string;
    summary: string;
    digest?: string;
  }>;
  /** Optional advisory finding; empty means no finding is written. */
  finding?: string;
  actorInstanceId?: string;
}

export interface ReviewChangesInput {
  taskId: string;
  expectedRevision?: number;
  attemptId: string;
  reviewedAttemptId: string;
  finding: string;
  actorInstanceId?: string;
}

export interface ReviewReplanInput {
  taskId: string;
  expectedRevision?: number;
  attemptId: string;
  reviewedAttemptId: string;
  reasonCode:
    | "replan_required"
    | "scope_changed"
    | "contract_changed"
    | "level_changed"
    | "manual_revision";
  finding: string;
  actorInstanceId?: string;
}

/** Review command result: the projected command data plus the exact
 * attempt/link/finding ids written by the command. */
export interface ReviewResultData extends CommandData {
  reviewAttemptId: string;
  reviewedAttemptId: string;
  findingId?: string;
  successorAttemptId?: string;
  newRevision?: number;
  l3Mode?: "modules" | "single";
  materializedChildren?: Array<{
    moduleKey: string;
    taskId: string;
    level: 1 | 2;
    reused: boolean;
  }>;
}

/** CAS guard: an explicit expectedRevision must match, an omitted one passes
 * against the current snapshot revision. */
export function resolveSnapshot(
  database: TaskcraftDatabase,
  taskId: string,
  expectedRevision: number | undefined,
): TaskSnapshot {
  if (expectedRevision === undefined) {
    const snapshot = getTask(database, taskId);

    if (snapshot === null) {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_NOT_FOUND, {
        problem: `Task ${taskId} does not exist`,
        impact: "The command cannot be applied because its task is unknown",
        remediation: "List known tasks with: tc task list",
        context: { taskId },
      });
    }

    return snapshot;
  }

  return checkRevision(database, taskId, expectedRevision);
}

export function assertNotCancelled(snapshot: TaskSnapshot): void {
  if (snapshot.cancelledAt !== null) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_ALREADY_CANCELLED, {
      problem: `Task ${snapshot.id} is already cancelled`,
      impact: "No new facts are written for a cancelled task",
      remediation: `Inspect the task with: tc task show ${snapshot.id}`,
      context: { taskId: snapshot.id },
    });
  }
}

/** Post-commit command data: task identity plus the projected status/next. */
export function commandData(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
): CommandData {
  const projection = project(database, taskId);

  return {
    taskId,
    taskRevision: snapshot.revision,
    status: projection.status,
    waitingReason: projection.waitingReason,
    next: projection.next,
  };
}

export function snapshotOf(
  database: TaskcraftDatabase,
  taskId: string,
): TaskSnapshot {
  return getTask(database, taskId)!;
}

export function requiredObligationError(
  taskId: string,
  obligationId: string,
): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_REQUIRED_OBLIGATION_MISSING, {
    problem: `Obligation ${obligationId} cannot be satisfied by the submitted result`,
    impact: "The task stays active; the attempt is not closed",
    remediation:
      "Submit validation evidence with: tc run complete <task-id> --result <json>",
    context: { taskId, obligationId },
  });
}

export function attemptRefError(
  taskId: string,
  problem: string,
  remediation: string,
): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
    problem,
    impact: "No facts were written",
    remediation,
    context: { taskId },
  });
}
