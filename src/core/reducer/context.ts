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

/** The shape accepted by the execute-1 result schema (after Ajv passed). */
export interface ExecuteResult {
  summary: string;
  evidence: Array<{
    type: "validation" | "test" | "artifact" | "note";
    reference: string;
    summary: string;
    digest?: string;
  }>;
  record?: { summary: string };
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
