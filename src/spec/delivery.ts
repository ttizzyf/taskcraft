import type { TaskcraftDatabase } from "../store/database.js";
import {
  getLifecycleSpecBindings,
  getSpecImpactResults,
  type LifecycleSpecBindingRow,
} from "../store/query.js";
import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { parseSpecImpactResult, type SpecImpactResult } from "./impact.js";

export interface SpecDeliveryBinding {
  lifecycleRevision: number;
  nodeId: string;
  id: string;
  kind: "engineering" | "domain";
  path: string;
  duty: "required" | "recommended";
  sourceKind: LifecycleSpecBindingRow["sourceKind"];
  sourceTaskId: string | null;
  sourceAttemptId: string | null;
}

export interface SpecDeliveryImpact {
  recordAttemptId: string;
  lifecycleRevision: number;
  recordNodeId: string;
  result: SpecImpactResult;
  createdBy: string;
  createdAt: string;
}

export interface SpecDeliveryView {
  bindings: SpecDeliveryBinding[];
  impacts: SpecDeliveryImpact[];
}

/** Shared command/Watch delivery query. SQLite owns the adopted bindings and
 * the recorded impacts; the Registry is deliberately not consulted, because a
 * binding records which documents a task adopted, not whether they still read
 * the same way today. Consumers render this DTO and never recompute semantics. */
export function loadSpecDeliveryView(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
): SpecDeliveryView {
  return {
    bindings: getLifecycleSpecBindings(database, taskId, revision).map(
      (binding) => ({
        lifecycleRevision: binding.lifecycleRevision,
        nodeId: binding.nodeId,
        id: binding.specId,
        kind: binding.specKind,
        path: binding.specPath,
        duty: binding.duty,
        sourceKind: binding.sourceKind,
        sourceTaskId: binding.sourceTaskId,
        sourceAttemptId: binding.sourceAttemptId,
      }),
    ),
    impacts: getSpecImpactResults(database, taskId, revision).map((row) => ({
      recordAttemptId: row.recordAttemptId,
      lifecycleRevision: row.lifecycleRevision,
      recordNodeId: row.recordNodeId,
      result: parseStoredSpecImpact(
        taskId,
        row.recordAttemptId,
        row.outcome,
        row.detailsJson,
      ),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    })),
  };
}

function parseStoredSpecImpact(
  taskId: string,
  recordAttemptId: string,
  outcome: "none" | "updated" | "candidate",
  detailsJson: string,
): SpecImpactResult {
  let details: unknown;
  try {
    details = JSON.parse(detailsJson) as unknown;
  } catch (cause) {
    throw invalidStoredImpact(taskId, recordAttemptId, cause);
  }
  if (
    typeof details !== "object" ||
    details === null ||
    Array.isArray(details)
  ) {
    throw invalidStoredImpact(taskId, recordAttemptId);
  }
  try {
    return parseSpecImpactResult({
      outcome,
      ...(details as Record<string, unknown>),
    });
  } catch (cause) {
    throw invalidStoredImpact(taskId, recordAttemptId, cause);
  }
}

function invalidStoredImpact(
  taskId: string,
  recordAttemptId: string,
  cause?: unknown,
): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_SPEC_IMPACT_INVALID, {
    problem: `Stored Spec Impact for ${recordAttemptId} is invalid`,
    impact: "Task show and Watch cannot render a trustworthy Spec Impact",
    remediation: "Run tc doctor and repair the damaged Spec Impact fact",
    context: { taskId, recordAttemptId },
    cause,
  });
}
