// Shared helpers for the four review reducer commands: the active review
// attempt resolution (reference validation + CAS-already-passed check),
// the review link writer, the finding writer and the revision supersede
// helper. All run inside the withTransaction of the command entry points.

import type { TaskcraftDatabase } from "../../store/database.js";
import {
  getAttempts,
  getReviewLinks,
  type ReviewCapability,
  type ReviewIndependenceStatus,
  type ReviewLinkRow,
  type ReviewPurpose,
} from "../../store/query.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";

export interface ResolvedReview {
  attempt: {
    id: string;
    taskId: string;
    lifecycleRevision: number;
    nodeId: string;
    host: string;
    status: "created" | "running";
  };
  link: ReviewLinkRow;
}

export function reviewRefError(
  taskId: string,
  problem: string,
  remediation: string,
): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_REVIEW_REF_INVALID, {
    problem,
    impact: "No facts were written",
    remediation,
    context: { taskId },
  });
}

/** Validates the caller's review attempt: it must be a review attempt of the
 * current revision whose link names the exact reviewed attempt, and it must
 * not be finished yet. Stable errors take precedence over SQLite triggers. */
export function resolveActiveReview(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  attemptId: string,
  reviewedAttemptId: string,
): ResolvedReview {
  const attempt = getAttempts(database, taskId).find(
    (candidate) => candidate.id === attemptId,
  );

  if (
    attempt === undefined ||
    attempt.taskId !== taskId ||
    attempt.lifecycleRevision !== snapshot.currentLifecycleRevision
  ) {
    throw reviewRefError(
      taskId,
      `Attempt ${attemptId} is not an attempt of the current lifecycle revision`,
      "Inspect the task state with: tc task show <task-id> --json",
    );
  }

  const link = getReviewLinks(database, taskId).find(
    (candidate) => candidate.reviewAttemptId === attempt.id,
  );

  if (link === undefined) {
    throw reviewRefError(
      taskId,
      `Attempt ${attemptId} is not a review attempt of this task`,
      "Start a review first with: tc review start <task-id> --purpose delivery",
    );
  }

  if (link.reviewedAttemptId !== reviewedAttemptId) {
    throw reviewRefError(
      taskId,
      `Attempt ${attemptId} reviews ${link.reviewedAttemptId}, not ${reviewedAttemptId}`,
      "Pass the reviewed attempt named by the review link from: tc task show <task-id> --json",
    );
  }

  if (attempt.status !== "created" && attempt.status !== "running") {
    throw new TaskcraftError(ERROR_CODES.TC_REVIEW_ALREADY_PASSED, {
      problem: `Review attempt ${attempt.id} is already finished`,
      impact: "No facts were written; the review cannot be repeated",
      remediation: `Inspect the task with: tc task show ${taskId} --json`,
      context: { taskId, attemptId: attempt.id },
    });
  }

  return { attempt: attempt as ResolvedReview["attempt"], link };
}

export interface ReviewLinkInput {
  taskId: string;
  reviewAttemptId: string;
  reviewedAttemptId: string;
  purpose: ReviewPurpose;
  capability: ReviewCapability;
  independenceStatus: ReviewIndependenceStatus;
  reviewerPrincipalId: string;
  observedHostSessionId: string | null;
  now: string;
}

export function insertReviewLink(
  database: TaskcraftDatabase,
  input: ReviewLinkInput,
): void {
  database
    .prepare(
      `INSERT INTO review_links (
         task_id, review_attempt_id, reviewed_attempt_id, review_purpose,
         capability, independence_status, reviewer_principal_id,
         observed_host_session_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.taskId,
      input.reviewAttemptId,
      input.reviewedAttemptId,
      input.purpose,
      input.capability,
      input.independenceStatus,
      input.reviewerPrincipalId,
      input.observedHostSessionId,
      input.now,
    );
}

export interface FindingInput {
  id: string;
  taskId: string;
  reviewAttemptId: string;
  severity: "blocking" | "advisory";
  summary: string;
  evidenceRefs: string[];
  now: string;
}

export function insertFinding(
  database: TaskcraftDatabase,
  input: FindingInput,
): void {
  database
    .prepare(
      `INSERT INTO review_findings (
         id, task_id, review_attempt_id, severity, disposition, summary,
         evidence_refs_json, resolved_by_attempt_id, created_at, resolved_at
       ) VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, ?, NULL)`,
    )
    .run(
      input.id,
      input.taskId,
      input.reviewAttemptId,
      input.severity,
      input.summary,
      JSON.stringify(input.evidenceRefs),
      input.now,
    );
}

export function nextFindingId(
  database: TaskcraftDatabase,
  taskId: string,
): string {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM review_findings WHERE task_id = ?")
    .get(taskId) as { count: number };

  return `fnd-${taskId}-${row.count + 1}`;
}

/** Marks every created/running attempt of a revision superseded. Finished,
 * failed and cancelled attempts keep their historical outcome untouched. */
export function supersedeRevisionAttempts(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
  now: string,
): void {
  database
    .prepare(
      `UPDATE node_attempts SET status = 'superseded', outcome = 'superseded',
              finished_at = ?
       WHERE task_id = ? AND lifecycle_revision = ?
         AND status IN ('created', 'running')`,
    )
    .run(now, taskId, revision);
}
