// Read-only query model for projectors and CLI rendering. Every function
// returns plain data snapshots via prepare().get/all and never exposes a
// write entry point.

import type { TaskcraftDatabase } from "./database.js";
import type { TaskSnapshot } from "./revision-guard.js";

// Appended task facts live in their own module (task-facts.ts) to keep this
// file under the line limit; the re-export keeps one query-model entry point.
export { getTaskFacts } from "./task-facts.js";
export type { TaskFactRow } from "./task-facts.js";

export type NodeKind =
  "frame" | "plan" | "execute" | "review" | "integrate" | "record";

export type AttemptStatus =
  "created" | "running" | "finished" | "failed" | "cancelled" | "superseded";

export type AttemptOutcome =
  | "success"
  | "passed"
  | "changes_requested"
  | "replan_required"
  | "blocked"
  | "failed"
  | "abandoned"
  | "unsupported"
  | "superseded";

export type ObligationDuty = "required" | "recommended" | "optional";

export interface NodeRow {
  taskId: string;
  lifecycleRevision: number;
  id: string;
  kind: NodeKind;
  title: string;
  objective: string;
  procedureRef: string;
  scopeJson: string;
  entryGateJson: string;
  exitGateJson: string;
  retryPolicyJson: string;
  inputSchemaJson: string;
  outputSchemaJson: string;
}

export interface EdgeRow {
  taskId: string;
  lifecycleRevision: number;
  fromNodeId: string;
  toNodeId: string;
  conditionJson: string;
  label: string | null;
}

export interface ObligationRow {
  taskId: string;
  lifecycleRevision: number;
  nodeId: string;
  id: string;
  duty: ObligationDuty;
  title: string;
  evaluatorJson: string;
}

export interface LifecycleGraph {
  nodes: NodeRow[];
  edges: EdgeRow[];
  obligations: ObligationRow[];
}

export interface AttemptRow {
  id: string;
  taskId: string;
  lifecycleRevision: number;
  nodeId: string;
  attemptNumber: number;
  actorInstanceId: string;
  host: string;
  status: AttemptStatus;
  outcome: AttemptOutcome | null;
  resultJson: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface EvidenceRow {
  id: string;
  taskId: string;
  nodeAttemptId: string | null;
  type: string;
  reference: string;
  summary: string;
  digest: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ObligationResultRow {
  taskId: string;
  lifecycleRevision: number;
  nodeId: string;
  obligationId: string;
  status: "satisfied" | "skipped";
  satisfiedByEvidenceId: string | null;
  skipReason: string | null;
  updatedAt: string;
}

export type BlockerKind =
  | "dependency"
  | "needs_input"
  | "needs_decision"
  | "evidence"
  | "host"
  | "conflict";

export type BlockerWaitingReason =
  | "blocked_dependency"
  | "needs_input"
  | "needs_decision"
  | "failed_retries_exhausted";

export interface BlockerRow {
  id: string;
  taskId: string;
  lifecycleRevision: number | null;
  nodeId: string | null;
  kind: BlockerKind;
  waitingReason: BlockerWaitingReason;
  status: "open" | "resolved";
  reason: string;
  remediationCommand: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export type ReviewPurpose = "feasibility" | "delivery" | "integration";

export type ReviewCapability =
  "context-only" | "manual-attach" | "host-observed";

export type ReviewIndependenceStatus =
  "observed-distinct" | "unverified" | "same-actor" | "unsupported";

export interface ReviewLinkRow {
  taskId: string;
  reviewAttemptId: string;
  reviewedAttemptId: string;
  reviewPurpose: ReviewPurpose;
  capability: ReviewCapability;
  independenceStatus: ReviewIndependenceStatus;
  reviewerPrincipalId: string | null;
  observedHostSessionId: string | null;
  createdAt: string;
}

export interface ReviewFindingRow {
  id: string;
  taskId: string;
  reviewAttemptId: string;
  severity: "blocking" | "advisory";
  disposition: "open" | "resolved" | "accepted";
  summary: string;
  evidenceRefsJson: string;
  resolvedByAttemptId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const TASK_SELECT = `SELECT id, title, level,
              objective_md AS objectiveMd,
              scope_json AS scopeJson,
              acceptance_json AS acceptanceJson,
              non_goals_json AS nonGoalsJson,
              classification_facts_json AS classificationFactsJson,
              classification_reasons_json AS classificationReasonsJson,
              parent_task_id AS parentTaskId,
              activated_at AS activatedAt,
              cancelled_at AS cancelledAt,
              cancel_reason AS cancelReason,
              current_lifecycle_revision AS currentLifecycleRevision,
              revision,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM tasks`;

export function getTask(
  database: TaskcraftDatabase,
  taskId: string,
): TaskSnapshot | null {
  const row = database.prepare(`${TASK_SELECT} WHERE id = ?`).get(taskId);

  return (row as TaskSnapshot | undefined) ?? null;
}

export function listTasks(database: TaskcraftDatabase): TaskSnapshot[] {
  return database
    .prepare(`${TASK_SELECT} ORDER BY rowid`)
    .all() as TaskSnapshot[];
}

export function getLifecycle(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
): LifecycleGraph {
  const nodes = database
    .prepare(
      `SELECT task_id AS taskId,
              lifecycle_revision AS lifecycleRevision,
              id, kind, title, objective,
              procedure_ref AS procedureRef,
              scope_json AS scopeJson,
              entry_gate_json AS entryGateJson,
              exit_gate_json AS exitGateJson,
              retry_policy_json AS retryPolicyJson,
              input_schema_json AS inputSchemaJson,
              output_schema_json AS outputSchemaJson
       FROM lifecycle_nodes
       WHERE task_id = ? AND lifecycle_revision = ?
       ORDER BY rowid`,
    )
    .all(taskId, revision) as NodeRow[];

  const edges = database
    .prepare(
      `SELECT task_id AS taskId,
              lifecycle_revision AS lifecycleRevision,
              from_node_id AS fromNodeId,
              to_node_id AS toNodeId,
              condition_json AS conditionJson,
              label
       FROM lifecycle_edges
       WHERE task_id = ? AND lifecycle_revision = ?
       ORDER BY fromNodeId, toNodeId`,
    )
    .all(taskId, revision) as EdgeRow[];

  const obligations = database
    .prepare(
      `SELECT task_id AS taskId,
              lifecycle_revision AS lifecycleRevision,
              node_id AS nodeId,
              id, duty, title,
              evaluator_json AS evaluatorJson
       FROM obligation_definitions
       WHERE task_id = ? AND lifecycle_revision = ?
       ORDER BY nodeId, id`,
    )
    .all(taskId, revision) as ObligationRow[];

  return { nodes, edges, obligations };
}

export function getAttempts(
  database: TaskcraftDatabase,
  taskId: string,
): AttemptRow[] {
  return database
    .prepare(
      `SELECT id, task_id AS taskId,
              lifecycle_revision AS lifecycleRevision,
              node_id AS nodeId,
              attempt_number AS attemptNumber,
              actor_instance_id AS actorInstanceId,
              host, status, outcome,
              result_json AS resultJson,
              started_at AS startedAt,
              finished_at AS finishedAt
       FROM node_attempts
       WHERE task_id = ?
       ORDER BY attempt_number, id`,
    )
    .all(taskId) as AttemptRow[];
}

export function getEvidence(
  database: TaskcraftDatabase,
  taskId: string,
): EvidenceRow[] {
  return database
    .prepare(
      `SELECT id, task_id AS taskId,
              node_attempt_id AS nodeAttemptId,
              type, reference, summary, digest,
              created_by AS createdBy,
              created_at AS createdAt
       FROM evidence
       WHERE task_id = ?
       ORDER BY created_at, id`,
    )
    .all(taskId) as EvidenceRow[];
}

export function getObligationResults(
  database: TaskcraftDatabase,
  taskId: string,
): ObligationResultRow[] {
  return database
    .prepare(
      `SELECT task_id AS taskId,
              lifecycle_revision AS lifecycleRevision,
              node_id AS nodeId,
              obligation_id AS obligationId,
              status,
              satisfied_by_evidence_id AS satisfiedByEvidenceId,
              skip_reason AS skipReason,
              updated_at AS updatedAt
       FROM obligation_results
       WHERE task_id = ?
       ORDER BY lifecycle_revision, nodeId, obligationId`,
    )
    .all(taskId) as ObligationResultRow[];
}

export function getOpenBlockers(
  database: TaskcraftDatabase,
  taskId: string,
): BlockerRow[] {
  return database
    .prepare(
      `SELECT id, task_id AS taskId,
              lifecycle_revision AS lifecycleRevision,
              node_id AS nodeId,
              kind, waiting_reason AS waitingReason, status,
              reason, remediation_command AS remediationCommand,
              created_at AS createdAt,
              resolved_at AS resolvedAt
       FROM blockers
       WHERE task_id = ? AND status = 'open'
       ORDER BY created_at, id`,
    )
    .all(taskId) as BlockerRow[];
}

export function getReviewLinks(
  database: TaskcraftDatabase,
  taskId: string,
): ReviewLinkRow[] {
  return database
    .prepare(
      `SELECT task_id AS taskId,
              review_attempt_id AS reviewAttemptId,
              reviewed_attempt_id AS reviewedAttemptId,
              review_purpose AS reviewPurpose,
              capability,
              independence_status AS independenceStatus,
              reviewer_principal_id AS reviewerPrincipalId,
              observed_host_session_id AS observedHostSessionId,
              created_at AS createdAt
       FROM review_links
       WHERE task_id = ?
       ORDER BY created_at, review_attempt_id`,
    )
    .all(taskId) as ReviewLinkRow[];
}

export function getReviewFindings(
  database: TaskcraftDatabase,
  taskId: string,
): ReviewFindingRow[] {
  return database
    .prepare(
      `SELECT id, task_id AS taskId,
              review_attempt_id AS reviewAttemptId,
              severity, disposition, summary,
              evidence_refs_json AS evidenceRefsJson,
              resolved_by_attempt_id AS resolvedByAttemptId,
              created_at AS createdAt,
              resolved_at AS resolvedAt
       FROM review_findings
       WHERE task_id = ?
       ORDER BY created_at, id`,
    )
    .all(taskId) as ReviewFindingRow[];
}

export type ObservationStatus =
  "pending" | "running" | "stale" | "finished" | "failed" | "unsupported";

export interface AgentRunRow {
  id: string;
  taskId: string;
  nodeAttemptId: string;
  host: string;
  hostRunId: string | null;
  hostSessionId: string | null;
  observationStatus: ObservationStatus;
  lastSeenAt: string | null;
  finishReason: string | null;
  observationJson: string;
}

export function getAgentRuns(
  database: TaskcraftDatabase,
  taskId?: string,
): AgentRunRow[] {
  return taskId === undefined
    ? (database
        .prepare(
          `SELECT id, task_id AS taskId,
                  node_attempt_id AS nodeAttemptId,
                  host, host_run_id AS hostRunId,
                  host_session_id AS hostSessionId,
                  observation_status AS observationStatus,
                  last_seen_at AS lastSeenAt,
                  finish_reason AS finishReason,
                  observation_json AS observationJson
           FROM agent_runs
           ORDER BY rowid`,
        )
        .all() as AgentRunRow[])
    : (database
        .prepare(
          `SELECT id, task_id AS taskId,
                  node_attempt_id AS nodeAttemptId,
                  host, host_run_id AS hostRunId,
                  host_session_id AS hostSessionId,
                  observation_status AS observationStatus,
                  last_seen_at AS lastSeenAt,
                  finish_reason AS finishReason,
                  observation_json AS observationJson
           FROM agent_runs
           WHERE task_id = ?
           ORDER BY rowid`,
        )
        .all(taskId) as AgentRunRow[]);
}

export function getLastEventSeq(
  database: TaskcraftDatabase,
  taskId: string,
): number {
  const row = database
    .prepare(
      "SELECT COALESCE(MAX(task_seq), 0) AS lastSeq FROM events WHERE task_id = ?",
    )
    .get(taskId) as { lastSeq: number };

  return row.lastSeq;
}
