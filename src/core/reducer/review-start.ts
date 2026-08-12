// reviewStart: opens a delivery review. In one transaction it validates the
// review node is runnable (execute satisfied and no open review attempt),
// resolves the reviewed execute attempt of the current revision, checks the
// purpose/kind match and the independence disclosure, then writes the review
// attempt, the review link and the audit event. No outcome is written.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getAttempts, getLifecycle } from "../../store/query.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import { L2_REVIEW_NODE_ID } from "../lifecycle/l2.js";
import { project } from "../projector.js";
import type { ReviewResultData, ReviewStartInput } from "./context.js";
import {
  assertNotCancelled,
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
import { insertReviewLink, reviewRefError } from "./review-shared.js";

const REVIEW_CAPABILITIES = ["context-only", "manual-attach", "host-observed"];
const REVIEW_INDEPENDENCE_STATUSES = [
  "observed-distinct",
  "unverified",
  "same-actor",
  "unsupported",
];

export function reviewStart(
  database: TaskcraftDatabase,
  taskId: string,
  input: ReviewStartInput,
): ReviewResultData {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);
    const nodeId = input.nodeId ?? L2_REVIEW_NODE_ID;
    const revision = snapshot.currentLifecycleRevision;
    const graph = getLifecycle(database, taskId, revision);
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);

    if (node === undefined || node.kind !== "review") {
      throw new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
        problem: `Node ${nodeId} is not a review node of the current lifecycle revision`,
        impact: "No facts were written",
        remediation: `Inspect the graph with: tc task show ${taskId} --json`,
        context: { taskId, nodeId },
      });
    }

    const nodeProjection = project(database, taskId).nodeStatuses.find(
      (candidate) => candidate.nodeId === nodeId,
    );

    if (nodeProjection?.status !== "runnable") {
      throw new TaskcraftError(ERROR_CODES.TC_ATTEMPT_REF_INVALID, {
        problem: `Node ${nodeId} cannot start a review: its status is ${nodeProjection?.status ?? "unknown"}`,
        impact: "No facts were written",
        remediation:
          "Complete the frame and execute nodes first, or follow the projected next command",
        context: { taskId, nodeId },
      });
    }

    const attempts = getAttempts(database, taskId).filter(
      (attempt) => attempt.lifecycleRevision === revision,
    );
    const reviewed = attempts.find(
      (attempt) => attempt.id === input.reviewedAttemptId,
    );
    const reviewedNode = graph.nodes.find(
      (candidate) => candidate.id === reviewed?.nodeId,
    );

    if (reviewed === undefined || reviewedNode?.kind !== "execute") {
      throw reviewRefError(
        taskId,
        `Attempt ${input.reviewedAttemptId} is not an execute attempt of the current revision`,
        "Pass the execute attempt id from: tc task show <task-id> --json",
      );
    }

    if (input.purpose !== "delivery") {
      throw new TaskcraftError(ERROR_CODES.TC_REVIEW_PURPOSE_MISMATCH, {
        problem: `Review purpose ${input.purpose} does not match the reviewed execute attempt`,
        impact:
          "No facts were written; the review link requires delivery for execute attempts",
        remediation: "Retry with --purpose delivery for an execute attempt",
        context: {
          taskId,
          purpose: input.purpose,
          reviewedAttemptId: reviewed.id,
        },
      });
    }

    validateIndependence(input);

    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const host = input.host ?? L1_DEFAULT_ACTOR;
    const now = nowIso();
    // Review attempt numbers advance per node across every lifecycle
    // revision: node_attempts.id is a global primary key, so a replanned
    // revision must not reuse the ids of superseded review attempts.
    const reviewNumber =
      getAttempts(database, taskId)
        .filter((attempt) => attempt.nodeId === nodeId)
        .reduce((max, attempt) => Math.max(max, attempt.attemptNumber), 0) + 1;
    const reviewAttempt = attemptId(taskId, nodeId, reviewNumber);

    insertAttempt(database, {
      id: reviewAttempt,
      taskId,
      lifecycleRevision: revision,
      nodeId,
      attemptNumber: reviewNumber,
      actorInstanceId: actor,
      host,
      status: "created",
      outcome: null,
      resultJson: null,
      startedAt: null,
      finishedAt: null,
    });
    insertReviewLink(database, {
      taskId,
      reviewAttemptId: reviewAttempt,
      reviewedAttemptId: reviewed.id,
      purpose: input.purpose,
      capability: input.capability,
      independenceStatus: input.independenceStatus,
      reviewerPrincipalId: actor,
      observedHostSessionId: input.observedHostSessionId ?? null,
      now,
    });
    insertEvent(database, {
      taskId,
      lifecycleRevision: revision,
      nodeId,
      attemptId: reviewAttempt,
      eventType: "review.started",
      payload: {
        purpose: input.purpose,
        reviewedAttemptId: reviewed.id,
        capability: input.capability,
        independenceStatus: input.independenceStatus,
      },
      postTaskRevision: snapshot.revision + 1,
      actorInstanceId: actor,
      host: input.host ?? null,
      occurredAt: now,
    });
    bumpRevision(database, snapshot, now);

    return {
      ...commandData(database, taskId, snapshotOf(database, taskId)),
      reviewAttemptId: reviewAttempt,
      reviewedAttemptId: reviewed.id,
    };
  });
}

/** The observed-distinct disclosure must be backed by a host-observed
 * capability plus a session id; every other combination is reported as-is. */
function validateIndependence(input: ReviewStartInput): void {
  const invalidDisclosure = (): TaskcraftError =>
    new TaskcraftError(ERROR_CODES.TC_REVIEW_INDEPENDENCE_INVALID, {
      problem: `Independence disclosure ${input.independenceStatus} / capability ${input.capability} is invalid`,
      impact:
        "No facts were written; the review link would violate the independence contract",
      remediation:
        "Use host-observed with --observed-host-session-id, or disclose unverified/same-actor truthfully",
      context: {
        taskId: input.taskId,
        capability: input.capability,
        independenceStatus: input.independenceStatus,
      },
    });

  if (
    !REVIEW_CAPABILITIES.includes(input.capability) ||
    !REVIEW_INDEPENDENCE_STATUSES.includes(input.independenceStatus)
  ) {
    throw invalidDisclosure();
  }

  if (
    input.independenceStatus === "observed-distinct" &&
    (input.capability !== "host-observed" ||
      input.observedHostSessionId === undefined ||
      input.observedHostSessionId.trim() === "")
  ) {
    throw invalidDisclosure();
  }
}
