// Plan and integrate completion for the L3 graph, plus the target-attempt
// resolution and the attempt-finished event writer shared with the execute,
// frame and record completions in run-complete.ts. Kept in its own file so
// every reducer file stays under the 400 effective-line limit.
//
// plan-1: validates against the plan result schema, generates the plan note
// evidence bound to the plan attempt, closes the attempt and satisfies the
// plan-completed obligation.
// integrate-1: validates against the integrate result schema, binds the
// integration evidence to the integrate attempt (a note evidence when the
// result carries none), closes the attempt and satisfies the
// integration-completed obligation. modifiedDeliverables decides whether the
// projector opens the on-demand integration review.

import type { TaskcraftDatabase } from "../../store/database.js";
import {
  getAttempts,
  getEvidence,
  getTask,
  getTaskRelations,
} from "../../store/query.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { project } from "../projector.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import {
  L3_INTEGRATE_NODE_ID,
  L3_OBLIGATION_IDS,
  L3_PLAN_NODE_ID,
} from "../lifecycle/l3.js";
import type { CommandData, RunCompleteInput } from "./context.js";
import { commandData, snapshotOf } from "./context.js";
import { validateIntegrateResult } from "./l3-materialize.js";
import { validateStoredNodeResult } from "./lifecycle-result.js";
import {
  bumpRevision,
  finishAttempt,
  insertEvent,
  insertEvidence,
  nowIso,
  satisfyObligation,
} from "./shared.js";

/** Picks the attempt to close: the caller's attemptId (validated against the
 * current revision and node) or the active attempt of the target node. */
export function resolveTargetAttempt(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  expectedAttemptId: string | undefined,
  nodeId: string,
) {
  const attempts = getAttempts(database, taskId).filter(
    (attempt) =>
      attempt.lifecycleRevision === snapshot.currentLifecycleRevision,
  );
  const attempt = expectedAttemptId
    ? attempts.find((candidate) => candidate.id === expectedAttemptId)
    : attempts.find(
        (candidate) =>
          candidate.nodeId === nodeId &&
          (candidate.status === "created" || candidate.status === "running"),
      );

  if (
    attempt === undefined ||
    attempt.nodeId !== nodeId ||
    (attempt.status !== "created" && attempt.status !== "running")
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
      problem: `No active ${nodeId} attempt belongs to this task revision`,
      impact: "No facts were written",
      remediation: `Claim an attempt first with: tc run <task-id> --node ${nodeId}`,
      context: { taskId, attemptId: expectedAttemptId ?? null, nodeId },
    });
  }

  return attempt;
}

/** Appends the attempt.finished audit event for a success outcome. */
export function insertAttemptFinishedEvent(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  attemptIdToFinish: string,
  nodeId: string,
  host: string,
  actor: string,
  now: string,
): void {
  insertEvent(database, {
    taskId,
    lifecycleRevision: snapshot.currentLifecycleRevision,
    nodeId,
    attemptId: attemptIdToFinish,
    eventType: "attempt.finished",
    payload: { outcome: "success" },
    postTaskRevision: snapshot.revision + 1,
    actorInstanceId: actor,
    host,
    occurredAt: now,
  });
}

export function completePlanNode(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  input: RunCompleteInput,
): CommandData {
  const result = input.result as { integrationPath?: string };

  if (
    !validateStoredNodeResult(
      database,
      taskId,
      snapshot.currentLifecycleRevision,
      L3_PLAN_NODE_ID,
      result,
    )
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID, {
      problem: `Result for ${L3_PLAN_NODE_ID} failed the node result schema`,
      impact: "No facts were written; the task keeps its current state",
      remediation:
        "Resubmit a plan result with decomposition, modules, coverage, dependencies, sharedValidations and integrationPath",
      context: { taskId },
    });
  }

  const attempt = resolveTargetAttempt(
    database,
    taskId,
    snapshot,
    input.attemptId,
    L3_PLAN_NODE_ID,
  );
  const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
  const now = nowIso();
  const evidenceId = `ev-${taskId}-${attempt.id}-1`;

  insertEvidence(database, {
    id: evidenceId,
    taskId,
    attemptId: attempt.id,
    type: "note",
    reference: `plan://${taskId}`,
    summary: result.integrationPath ?? "Plan",
    digest: null,
    actor,
    now,
  });
  finishAttempt(database, attempt.id, result, now);
  satisfyObligation(
    database,
    taskId,
    snapshot,
    L3_PLAN_NODE_ID,
    L3_OBLIGATION_IDS.planCompleted,
    evidenceId,
    now,
  );
  insertAttemptFinishedEvent(
    database,
    taskId,
    snapshot,
    attempt.id,
    attempt.nodeId,
    attempt.host,
    actor,
    now,
  );
  bumpRevision(database, snapshot, now);

  return commandData(database, taskId, snapshotOf(database, taskId));
}

export function completeIntegrateNode(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  input: RunCompleteInput,
): CommandData {
  const result = input.result as IntegrateResultShape;

  if (!validateIntegrateResult(result)) {
    throw new TaskcraftError(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID, {
      problem: `Result for ${L3_INTEGRATE_NODE_ID} failed the node result schema`,
      impact: "No facts were written; the task keeps its current state",
      remediation:
        "Resubmit an integrate result with childrenResults and integrationEvidence",
      context: { taskId },
    });
  }

  validateIntegrateReferences(database, taskId, snapshot, result);

  const attempt = resolveTargetAttempt(
    database,
    taskId,
    snapshot,
    input.attemptId,
    L3_INTEGRATE_NODE_ID,
  );
  const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
  const now = nowIso();
  const evidenceIds =
    result.integrationEvidence.length === 0
      ? [
          insertNoteEvidence(
            database,
            taskId,
            attempt.id,
            "integrate://" + taskId,
            "Integration combined without deliverables",
            actor,
            now,
          ),
        ]
      : result.integrationEvidence.map((evidence, index) => {
          const id = `ev-${taskId}-${attempt.id}-${index + 1}`;
          insertEvidence(database, {
            id,
            taskId,
            attemptId: attempt.id,
            type: evidence.type,
            reference: evidence.reference,
            summary: evidence.summary,
            digest: evidence.digest ?? null,
            actor,
            now,
          });
          return id;
        });

  finishAttempt(database, attempt.id, result, now);
  satisfyObligation(
    database,
    taskId,
    snapshot,
    L3_INTEGRATE_NODE_ID,
    L3_OBLIGATION_IDS.integrationCompleted,
    evidenceIds[0]!,
    now,
  );
  insertAttemptFinishedEvent(
    database,
    taskId,
    snapshot,
    attempt.id,
    attempt.nodeId,
    attempt.host,
    actor,
    now,
  );
  bumpRevision(database, snapshot, now);

  return commandData(database, taskId, snapshotOf(database, taskId));
}

function insertNoteEvidence(
  database: TaskcraftDatabase,
  taskId: string,
  attemptId: string,
  reference: string,
  summary: string,
  actor: string,
  now: string,
): string {
  const id = `ev-${taskId}-${attemptId}-1`;
  insertEvidence(database, {
    id,
    taskId,
    attemptId,
    type: "note",
    reference,
    summary,
    digest: null,
    actor,
    now,
  });

  return id;
}

/** The shape accepted by the integrate-1 result schema (after Ajv passed). */
interface IntegrateResultShape {
  childrenResults: Array<{
    taskId: string;
    taskRevision: number;
    evidenceRefs: string[];
  }>;
  integrationEvidence: Array<{
    type: "validation" | "test" | "artifact" | "note";
    reference: string;
    summary: string;
    digest?: string;
  }>;
  modifiedDeliverables?: boolean;
}

function validateIntegrateReferences(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  result: IntegrateResultShape,
): void {
  const relations = getTaskRelations(
    database,
    taskId,
    snapshot.currentLifecycleRevision,
  );
  const requiredChildren = relations.children.filter(
    (child) => child.requirementStatus === "required",
  );
  const submitted = new Map(
    result.childrenResults.map((child) => [child.taskId, child]),
  );
  const invalid = (problem: string): never => {
    throw new TaskcraftError(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID, {
      problem,
      impact: "No integration facts were written; the attempt remains open",
      remediation:
        "Re-read tc task show <task-id> --json and reference each current required child revision and evidence",
      context: { taskId },
    });
  };

  if (relations.executionSource?.mode === "single") {
    if (result.childrenResults.length > 0) {
      invalid("A single L3 integration cannot claim child results");
    }
    return;
  }

  if (
    relations.executionSource?.mode === "modules" &&
    (result.childrenResults.length !== requiredChildren.length ||
      submitted.size !== requiredChildren.length ||
      requiredChildren.some((child) => !submitted.has(child.childTaskId)))
  ) {
    invalid(
      "Integration must reference every current required child exactly once",
    );
  }

  for (const requirement of requiredChildren) {
    const reference = submitted.get(requirement.childTaskId)!;
    const child =
      getTask(database, requirement.childTaskId) ??
      invalid(`Child ${requirement.childTaskId} does not exist`);
    if (
      child.revision !== reference.taskRevision ||
      project(database, child.id).status !== "done"
    ) {
      invalid(
        `Child ${requirement.childTaskId} is not done at the referenced revision`,
      );
    }
    const evidenceIds = new Set(
      getEvidence(database, child.id).map((row) => row.id),
    );
    if (
      reference.evidenceRefs.some((evidenceId) => !evidenceIds.has(evidenceId))
    ) {
      invalid(
        `Child ${child.id} integration evidence does not belong to that child`,
      );
    }
  }
}
