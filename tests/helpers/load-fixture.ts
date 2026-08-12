// Loads development/contracts/fixtures/*.fixture.json (tc-fixture/v1 fact
// snapshots) into a migrated database. All inserts happen inside one
// transaction so fixture import is atomic and rollback-safe.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { TaskcraftDatabase } from "../../src/store/database.js";
import type { FixtureDocument, FixtureTask } from "./fixture-document.js";

const FIXED_TIMESTAMP = "2026-08-11T00:00:00.000Z";

export function fixturePath(name: string): string {
  return fileURLToPath(
    new URL(
      `../../development/contracts/fixtures/${name}.fixture.json`,
      import.meta.url,
    ),
  );
}

export function loadFixtureFile(
  database: TaskcraftDatabase,
  name: string,
): void {
  loadFixture(database, JSON.parse(readFileSync(fixturePath(name), "utf8")));
}

export function loadFixture(database: TaskcraftDatabase, raw: unknown): void {
  const fixture = raw as FixtureDocument;
  const revisionByTask = new Map(
    fixture.tasks.map((task) => [task.id, task.currentLifecycleRevision ?? 1]),
  );
  const revisionOf = (taskId: string): number =>
    revisionByTask.get(taskId) ?? 1;

  runInTransaction(database, () => {
    for (const task of fixture.tasks) {
      insertTask(database, task);
      insertLifecycleRevisions(database, task);
    }

    for (const lifecycle of fixture.lifecycles) {
      insertGraph(
        database,
        lifecycle,
        lifecycle.revision ?? revisionOf(lifecycle.taskId),
      );
    }

    for (const attempt of fixture.attempts) {
      insertAttempt(
        database,
        attempt,
        attempt.lifecycleRevision ?? revisionOf(attempt.taskId),
      );
    }

    for (const evidence of fixture.evidence) {
      insertEvidence(database, evidence);
    }

    for (const link of fixture.reviewLinks ?? []) {
      insertReviewLink(database, link);
    }

    for (const result of fixture.obligationResults) {
      insertObligationResult(
        database,
        result,
        result.lifecycleRevision ?? revisionOf(result.taskId),
      );
    }

    for (const finding of fixture.reviewFindings ?? []) {
      insertReviewFinding(database, finding);
    }

    for (const blocker of fixture.blockers) {
      insertBlocker(database, blocker, revisionOf(blocker.taskId));
    }

    for (const agentRun of fixture.agentRuns) {
      insertAgentRun(database, agentRun);
    }

    insertEvents(database, fixture.events, revisionOf);
  });
}

function insertTask(database: TaskcraftDatabase, task: FixtureTask): void {
  database
    .prepare(
      `INSERT INTO tasks (
         id, title, level, objective_md, scope_json, acceptance_json,
         non_goals_json, classification_facts_json, classification_reasons_json,
         parent_task_id, activated_at, cancelled_at, cancel_reason,
         current_lifecycle_revision, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, '{}', '[]', '[]', '{}', '[]', NULL, ?, ?, ?,
         ?, ?, ?, ?)`,
    )
    .run(
      task.id,
      task.title,
      task.level,
      task.objectiveMd,
      task.activatedAt,
      task.cancelledAt,
      task.cancelReason,
      task.currentLifecycleRevision ?? 1,
      task.revision,
      FIXED_TIMESTAMP,
      FIXED_TIMESTAMP,
    );
}

function insertLifecycleRevisions(
  database: TaskcraftDatabase,
  task: FixtureTask,
): void {
  const revisions = task.revisions ?? [task.currentLifecycleRevision ?? 1];
  const insert = database.prepare(
    `INSERT INTO lifecycle_revisions (
       task_id, revision, reason_code, reason, compiler_version,
       facts_digest, policy_digest, change_summary_json, created_by,
       created_at
     ) VALUES (?, ?, ?, ?, 'tc-l1/1',
       'facts-digest', 'policy-digest', '{}', 'tester', ?)`,
  );

  for (const revision of revisions) {
    insert.run(
      task.id,
      revision,
      revision === 1 ? "initial" : "replan_required",
      revision === 1 ? "initial L1 lifecycle" : "replanned fixture revision",
      FIXED_TIMESTAMP,
    );
  }
}

function insertGraph(
  database: TaskcraftDatabase,
  lifecycle: FixtureDocument["lifecycles"][number],
  revision: number,
): void {
  const insertNode = database.prepare(
    `INSERT INTO lifecycle_nodes (
       task_id, lifecycle_revision, id, kind, title, objective,
       procedure_ref, scope_json, entry_gate_json, exit_gate_json,
       retry_policy_json, input_schema_json, output_schema_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '{}', '{}', '{}', '{}', ?)`,
  );
  for (const node of lifecycle.nodes) {
    insertNode.run(
      lifecycle.taskId,
      revision,
      node.id,
      node.kind,
      node.title,
      node.objective,
      node.procedureRef,
      JSON.stringify(node.outputSchema ?? {}),
    );
  }

  const insertEdge = database.prepare(
    `INSERT INTO lifecycle_edges (
       task_id, lifecycle_revision, from_node_id, to_node_id,
       condition_json, label
     ) VALUES (?, ?, ?, ?, ?, NULL)`,
  );
  for (const edge of lifecycle.edges) {
    insertEdge.run(
      lifecycle.taskId,
      revision,
      edge.from,
      edge.to,
      JSON.stringify(edge.condition ?? { kind: "always" }),
    );
  }

  const insertObligation = database.prepare(
    `INSERT INTO obligation_definitions (
       task_id, lifecycle_revision, node_id, id, duty, title, evaluator_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const obligation of lifecycle.obligations) {
    insertObligation.run(
      lifecycle.taskId,
      revision,
      obligation.nodeId,
      obligation.id,
      obligation.duty,
      obligation.title,
      JSON.stringify(obligation.evaluator ?? {}),
    );
  }
}

function insertAttempt(
  database: TaskcraftDatabase,
  attempt: FixtureDocument["attempts"][number],
  revision: number,
): void {
  database
    .prepare(
      `INSERT INTO node_attempts (
         id, task_id, lifecycle_revision, node_id, attempt_number,
         actor_instance_id, host, status, outcome, result_json, started_at,
         finished_at
       ) VALUES (?, ?, ?, ?, ?, 'actor-1', 'host-1', ?, ?, ?, ?, ?)`,
    )
    .run(
      attempt.id,
      attempt.taskId,
      revision,
      attempt.nodeId,
      attempt.attemptNumber ?? 1,
      attempt.status,
      attempt.outcome,
      attempt.resultJson === undefined
        ? null
        : JSON.stringify(attempt.resultJson),
      attempt.startedAt,
      attempt.finishedAt,
    );
}

function insertEvidence(
  database: TaskcraftDatabase,
  evidence: FixtureDocument["evidence"][number],
): void {
  database
    .prepare(
      `INSERT INTO evidence (
         id, task_id, node_attempt_id, type, reference, summary, digest,
         created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'actor-1', ?)`,
    )
    .run(
      evidence.id,
      evidence.taskId,
      evidence.nodeAttemptId,
      evidence.type,
      evidence.reference,
      evidence.summary,
      evidence.digest ?? null,
      FIXED_TIMESTAMP,
    );
}

function insertReviewLink(
  database: TaskcraftDatabase,
  link: FixtureDocument["reviewLinks"][number],
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
      link.taskId,
      link.reviewAttemptId,
      link.reviewedAttemptId,
      link.purpose,
      link.capability,
      link.independenceStatus,
      link.reviewerPrincipalId ?? "actor-1",
      link.observedHostSessionId ?? null,
      FIXED_TIMESTAMP,
    );
}

function insertReviewFinding(
  database: TaskcraftDatabase,
  finding: FixtureDocument["reviewFindings"][number],
): void {
  database
    .prepare(
      `INSERT INTO review_findings (
         id, task_id, review_attempt_id, severity, disposition, summary,
         evidence_refs_json, resolved_by_attempt_id, created_at, resolved_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      finding.id,
      finding.taskId,
      finding.reviewAttemptId,
      finding.severity,
      finding.disposition ?? "open",
      finding.summary,
      JSON.stringify(finding.evidenceRefs ?? []),
      finding.resolvedByAttemptId ?? null,
      FIXED_TIMESTAMP,
      finding.resolvedAt ?? null,
    );
}

function insertObligationResult(
  database: TaskcraftDatabase,
  result: FixtureDocument["obligationResults"][number],
  revision: number,
): void {
  database
    .prepare(
      `INSERT INTO obligation_results (
         task_id, lifecycle_revision, node_id, obligation_id, status,
         satisfied_by_evidence_id, skip_reason, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      result.taskId,
      revision,
      result.nodeId,
      result.obligationId,
      result.status,
      result.satisfiedByEvidenceId,
      FIXED_TIMESTAMP,
    );
}

function insertBlocker(
  database: TaskcraftDatabase,
  blocker: FixtureDocument["blockers"][number],
  revision: number,
): void {
  database
    .prepare(
      `INSERT INTO blockers (
         id, task_id, lifecycle_revision, node_id, kind, waiting_reason,
         status, reason, remediation_command, created_at, resolved_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      blocker.id,
      blocker.taskId,
      revision,
      blocker.nodeId,
      blocker.kind,
      blocker.waitingReason,
      blocker.status,
      blocker.reason,
      blocker.remediationCommand,
      FIXED_TIMESTAMP,
    );
}

function insertAgentRun(
  database: TaskcraftDatabase,
  agentRun: FixtureDocument["agentRuns"][number],
): void {
  database
    .prepare(
      `INSERT INTO agent_runs (
         id, task_id, node_attempt_id, host, host_run_id, host_session_id,
         observation_status, last_seen_at, finish_reason, observation_json
       ) VALUES (?, ?, ?, 'host-1', NULL, NULL, ?, ?, ?, '{}')`,
    )
    .run(
      agentRun.id,
      agentRun.taskId,
      agentRun.nodeAttemptId,
      agentRun.observationStatus,
      FIXED_TIMESTAMP,
      agentRun.finishReason ?? null,
    );
}

function insertEvents(
  database: TaskcraftDatabase,
  events: FixtureDocument["events"],
  revisionOf: (taskId: string) => number,
): void {
  const taskSeqs = new Map<string, number>();

  for (const event of events) {
    const taskSeq = (taskSeqs.get(event.taskId) ?? 0) + 1;
    taskSeqs.set(event.taskId, taskSeq);

    database
      .prepare(
        `INSERT INTO events (
           event_id, task_id, task_seq, lifecycle_revision, node_id,
           attempt_id, actor_instance_id, host, event_type, payload_json,
           post_task_revision, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'actor-1', 'host-1', ?, '{}', ?, ?)`,
      )
      .run(
        `evt-${event.taskId}-${taskSeq}`,
        event.taskId,
        taskSeq,
        event.lifecycleRevision ?? revisionOf(event.taskId),
        event.nodeId,
        event.attemptId,
        event.eventType,
        event.postTaskRevision ?? 1,
        FIXED_TIMESTAMP,
      );
  }
}

function runInTransaction<T>(database: TaskcraftDatabase, fn: () => T): T {
  if (database.inTransaction) {
    return fn();
  }

  database.exec("BEGIN IMMEDIATE");

  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (cause) {
    if (database.inTransaction) {
      database.exec("ROLLBACK");
    }

    throw cause;
  }
}
