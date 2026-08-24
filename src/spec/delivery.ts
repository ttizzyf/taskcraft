import type { TaskcraftDatabase } from "../store/database.js";
import {
  getLifecycleSpecBindings,
  getSpecImpactResults,
  type LifecycleSpecBindingRow,
} from "../store/query.js";
import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { evaluateSpecBindingDrift } from "./bindings.js";
import type { SpecBindingDriftReason } from "./bindings.js";
import { parseSpecImpactResult, type SpecImpactResult } from "./impact.js";
import { loadSpecRegistry } from "./registry.js";
import type { LoadedSpecRegistry } from "./types.js";

export interface SpecDeliveryBinding {
  lifecycleRevision: number;
  nodeId: string;
  id: string;
  kind: "engineering" | "domain";
  path: string;
  digest: string;
  duty: "required" | "recommended";
  sourceKind: LifecycleSpecBindingRow["sourceKind"];
  sourceTaskId: string | null;
  sourceAttemptId: string | null;
  drift: { status: "current" | "stale"; reasons: SpecBindingDriftReason[] };
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
  registryIssue: {
    code: string;
    problem: string;
    remediation: string;
  } | null;
}

/** Shared command/Watch delivery query. SQLite owns adopted snapshots and
 * impacts; the Registry service is called once only to annotate current
 * drift. Consumers render this DTO and never recompute semantics. */
export function loadSpecDeliveryView(
  projectDir: string,
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
): SpecDeliveryView {
  const bindings = getLifecycleSpecBindings(database, taskId, revision);
  let registry: LoadedSpecRegistry | null = null;
  let registryIssue: SpecDeliveryView["registryIssue"] = null;
  if (bindings.length > 0) {
    try {
      registry = loadSpecRegistry(projectDir);
    } catch (error) {
      if (!(error instanceof TaskcraftError)) throw error;
      registryIssue = {
        code: error.code,
        problem: error.problem,
        remediation: error.remediation,
      };
    }
  }
  return buildSpecDeliveryView(
    database,
    taskId,
    revision,
    registry,
    registryIssue,
  );
}

export function buildSpecDeliveryView(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
  registry: LoadedSpecRegistry | null,
  registryIssue: SpecDeliveryView["registryIssue"] = null,
): SpecDeliveryView {
  const bindings = getLifecycleSpecBindings(database, taskId, revision);
  const drift =
    registry === null
      ? bindings.map((binding) => ({
          binding,
          status: "stale" as const,
          reasons: ["registry_unavailable" as const],
        }))
      : evaluateSpecBindingDrift(registry, bindings);
  return {
    bindings: drift.map((item) => ({
      lifecycleRevision: item.binding.lifecycleRevision,
      nodeId: item.binding.nodeId,
      id: item.binding.specId,
      kind: item.binding.specKind,
      path: item.binding.specPath,
      digest: item.binding.specDigest,
      duty: item.binding.duty,
      sourceKind: item.binding.sourceKind,
      sourceTaskId: item.binding.sourceTaskId,
      sourceAttemptId: item.binding.sourceAttemptId,
      drift: { status: item.status, reasons: [...item.reasons] },
    })),
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
    registryIssue,
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
