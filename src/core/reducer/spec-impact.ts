import {
  assertResolvedSpecImpact,
  parseSpecImpactResult,
  type SpecImpactResult,
} from "../../spec/impact.js";
import type { TaskcraftDatabase } from "../../store/database.js";
import { insertSpecImpactResult } from "../../store/spec-facts.js";
import { getEvidence } from "../../store/query.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_OBLIGATION_IDS, L1_RECORD_NODE_ID } from "../lifecycle/l1.js";
import { satisfyObligation } from "./shared.js";

export function recordSpecImpact(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: TaskSnapshot,
  recordAttemptId: string,
  recordEvidenceId: string,
  value: unknown,
  resolved: SpecImpactResult | undefined,
  actor: string,
  now: string,
): void {
  if (
    !requiresSpecImpact(database, taskId, snapshot.currentLifecycleRevision)
  ) {
    return;
  }
  const impact = parseSpecImpactResult(value);
  assertResolvedSpecImpact(impact, resolved);
  assertUpdatedEvidence(database, taskId, recordEvidenceId, impact);
  const { outcome, ...details } = impact;
  insertSpecImpactResult(database, {
    recordAttemptId,
    taskId,
    lifecycleRevision: snapshot.currentLifecycleRevision,
    recordNodeId: L1_RECORD_NODE_ID,
    outcome,
    details,
    actor,
    now,
  });
  satisfyObligation(
    database,
    taskId,
    snapshot,
    L1_RECORD_NODE_ID,
    L1_OBLIGATION_IDS.specImpactRecorded,
    recordEvidenceId,
    now,
  );
}

export function requiresSpecImpact(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
): boolean {
  return (
    database
      .prepare(
        `SELECT 1 FROM obligation_definitions
         WHERE task_id = ? AND lifecycle_revision = ? AND node_id = ? AND id = ?`,
      )
      .get(
        taskId,
        revision,
        L1_RECORD_NODE_ID,
        L1_OBLIGATION_IDS.specImpactRecorded,
      ) !== undefined
  );
}

function assertUpdatedEvidence(
  database: TaskcraftDatabase,
  taskId: string,
  recordEvidenceId: string,
  impact: SpecImpactResult,
): void {
  if (impact.outcome !== "updated") return;
  const evidenceIds = new Set(
    getEvidence(database, taskId)
      .filter(
        (evidence) =>
          evidence.id !== recordEvidenceId &&
          ["validation", "test", "artifact"].includes(evidence.type),
      )
      .map((evidence) => evidence.id),
  );
  const unknown = impact.updates.flatMap((update) =>
    update.evidenceRefs.filter((evidenceId) => !evidenceIds.has(evidenceId)),
  );
  if (unknown.length > 0) {
    throw new TaskcraftError(ERROR_CODES.TC_SPEC_IMPACT_INVALID, {
      problem: `Updated Spec Impact references evidence not owned by Task ${taskId}: ${[...new Set(unknown)].join(", ")}`,
      impact:
        "No Record, Spec Impact, evidence or obligation facts were written",
      remediation:
        "Reference validation, test or artifact evidence already owned by this Task; note evidence cannot prove a Spec update",
      context: { taskId },
    });
  }
}
