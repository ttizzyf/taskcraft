// runComplete: validates the submitted result against the target node's
// result schema (no facts are written on failure), binds the evidence to the
// target attempt, closes the attempt and satisfies its obligations.
//
// execute-1: the execute result can carry a `record` segment, which
// materializes the record attempt and satisfies the record obligation in the
// same transaction. record-1 (claimed after a record-less execute result)
// completes the record node standalone: a note evidence row is generated for
// the record obligation's evidence-owner trigger.

import type { TaskcraftDatabase } from "../../store/database.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import {
  L1_DEFAULT_ACTOR,
  L1_EXECUTE_NODE_ID,
  L1_OBLIGATION_IDS,
  L1_RECORD_NODE_ID,
} from "../lifecycle/l1.js";
import { L2_FRAME_NODE_ID, L2_OBLIGATION_IDS } from "../lifecycle/l2.js";
import { L3_INTEGRATE_NODE_ID, L3_PLAN_NODE_ID } from "../lifecycle/l3.js";
import type { CommandData, RunCompleteInput } from "./context.js";
import {
  assertNotCancelled,
  commandData,
  requiredObligationError,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import {
  bumpRevision,
  finishAttempt,
  insertEvidence,
  nowIso,
  satisfyObligation,
} from "./shared.js";
import {
  completeIntegrateNode,
  completePlanNode,
  insertAttemptFinishedEvent,
  resolveTargetAttempt,
} from "./run-complete-nodes.js";
import { isSpecBindingL2CompilerVersion } from "../lifecycle/l2.js";
import type { SpecSelection } from "../../spec/bindings.js";
import { assertResolvedSpecSelections } from "../../spec/bindings.js";
import { insertLifecycleSpecBindings } from "../../store/spec-facts.js";
import { validateStoredNodeResult } from "./lifecycle-result.js";
import {
  completeRecordNode,
  type RecordResultShape,
  writeRecordResult,
} from "./run-complete-record.js";

export function runComplete(
  database: TaskcraftDatabase,
  taskId: string,
  input: RunCompleteInput,
): CommandData {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);
    const nodeId = input.nodeId ?? L1_EXECUTE_NODE_ID;

    if (nodeId === L2_FRAME_NODE_ID) {
      return completeFrameNode(database, taskId, snapshot, input);
    }

    if (nodeId === L3_PLAN_NODE_ID) {
      return completePlanNode(database, taskId, snapshot, input);
    }

    if (nodeId === L1_EXECUTE_NODE_ID) {
      return completeExecuteNode(database, taskId, snapshot, input);
    }

    if (nodeId === L3_INTEGRATE_NODE_ID) {
      return completeIntegrateNode(database, taskId, snapshot, input);
    }

    if (nodeId === L1_RECORD_NODE_ID) {
      return completeRecordNode(database, taskId, snapshot, input);
    }

    throw new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
      problem: `Node ${nodeId} cannot be completed`,
      impact: "No facts were written",
      remediation:
        "Complete frame-1, plan-1, execute-1, integrate-1 or record-1 with: tc run complete <task-id> --node <node>",
      context: { taskId, nodeId },
    });
  });
}

function completeExecuteNode(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  input: RunCompleteInput,
): CommandData {
  const result = input.result as ExecuteResultShape;

  if (
    !validateStoredNodeResult(
      database,
      taskId,
      snapshot.currentLifecycleRevision,
      L1_EXECUTE_NODE_ID,
      result,
    )
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID, {
      problem: `Result for ${L1_EXECUTE_NODE_ID} failed the node result schema`,
      impact: "No facts were written; the task keeps its current state",
      remediation:
        "Resubmit a result matching the execute-1 result schema from the Node Brief",
      context: { taskId },
    });
  }

  const attempt = resolveTargetAttempt(
    database,
    taskId,
    snapshot,
    input.attemptId,
    L1_EXECUTE_NODE_ID,
  );

  if (result.evidence.length === 0) {
    throw requiredObligationError(
      taskId,
      L1_OBLIGATION_IDS.requestedOutcomeProduced,
    );
  }

  const validationEvidence = result.evidence.find(
    (evidence) => evidence.type === "validation",
  );

  if (validationEvidence === undefined) {
    throw requiredObligationError(
      taskId,
      L1_OBLIGATION_IDS.minimumValidationRecorded,
    );
  }

  const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
  const now = nowIso();
  const evidenceIds = result.evidence.map((evidence, index) => {
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
    L1_EXECUTE_NODE_ID,
    L1_OBLIGATION_IDS.requestedOutcomeProduced,
    evidenceIds[0]!,
    now,
  );
  satisfyObligation(
    database,
    taskId,
    snapshot,
    L1_EXECUTE_NODE_ID,
    L1_OBLIGATION_IDS.minimumValidationRecorded,
    evidenceIds[result.evidence.indexOf(validationEvidence)]!,
    now,
  );

  if (result.record !== undefined) {
    writeRecordResult(
      database,
      taskId,
      snapshot,
      result.record,
      input.resolvedSpecImpact,
      actor,
      now,
    );
  }

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

/** Frame completion (L2/L3): validates the level-specific frame result, generates the note
 * evidence bound to the frame attempt, closes the attempt and satisfies the
 * frame-completed obligation. */
function completeFrameNode(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  input: RunCompleteInput,
): CommandData {
  const result = input.result as {
    objective: string;
    specBindings?: SpecSelection[];
  };

  const valid = validateStoredNodeResult(
    database,
    taskId,
    snapshot.currentLifecycleRevision,
    L2_FRAME_NODE_ID,
    result,
  );

  if (!valid) {
    throw new TaskcraftError(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID, {
      problem: `Result for ${L2_FRAME_NODE_ID} failed the node result schema`,
      impact: "No facts were written; the task keeps its current state",
      remediation:
        snapshot.level === 3
          ? "Resubmit a result matching the L3 frame schema (objective, scope, acceptanceAnchors, nonGoals)"
          : "Resubmit a result matching the frame-1 result schema (objective, scope, acceptance)",
      context: { taskId },
    });
  }

  const attempt = resolveTargetAttempt(
    database,
    taskId,
    snapshot,
    input.attemptId,
    L2_FRAME_NODE_ID,
  );
  const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
  const now = nowIso();
  const evidenceId = `ev-${taskId}-${attempt.id}-1`;

  const compiler = database
    .prepare(
      `SELECT compiler_version AS compilerVersion
       FROM lifecycle_revisions WHERE task_id = ? AND revision = ?`,
    )
    .get(taskId, snapshot.currentLifecycleRevision) as {
    compilerVersion: string;
  };
  if (
    snapshot.level === 2 &&
    isSpecBindingL2CompilerVersion(compiler.compilerVersion)
  ) {
    assertResolvedSpecSelections(
      result.specBindings ?? [],
      input.resolvedSpecBindings ?? [],
      "L2 Frame Spec bindings",
    );
    insertLifecycleSpecBindings(database, {
      taskId,
      lifecycleRevision: snapshot.currentLifecycleRevision,
      nodeIds: ["execute-1", "review-1", "record-1"],
      bindings: input.resolvedSpecBindings ?? [],
      source: { kind: "frame", taskId, attemptId: attempt.id },
      actor,
      now,
    });
  }

  insertEvidence(database, {
    id: evidenceId,
    taskId,
    attemptId: attempt.id,
    type: "note",
    reference: `frame://${taskId}`,
    summary: result.objective,
    digest: null,
    actor,
    now,
  });
  finishAttempt(database, attempt.id, result, now);
  satisfyObligation(
    database,
    taskId,
    snapshot,
    L2_FRAME_NODE_ID,
    L2_OBLIGATION_IDS.frameCompleted,
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

/** The shape accepted by the execute-1 result schema (after Ajv passed). */
interface ExecuteResultShape {
  summary: string;
  evidence: Array<{
    type: "validation" | "test" | "artifact" | "note";
    reference: string;
    summary: string;
    digest?: string;
  }>;
  record?: RecordResultShape;
}
