import type { EvalReport } from "../core/types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isActorSession(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.phase === "string" &&
    typeof value.status === "string" &&
    typeof value.elapsedMs === "number" &&
    Array.isArray(value.diagnostics)
  );
}

function isCheckResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.grader === "string" &&
    typeof value.verdict === "string" &&
    typeof value.reason === "string" &&
    Array.isArray(value.evidence)
  );
}

/** Validates the fields the board actually renders. A JSON-valid file that is
 * missing arrays or uses wrong primitive types must be reported as a malformed
 * diagnostic instead of crashing the whole /api/data response. */
export function isLoadableReport(value: unknown): value is EvalReport {
  return (
    isRecord(value) &&
    typeof value.caseId === "string" &&
    value.caseId !== "" &&
    typeof value.verdict === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.finishedAt === "string" &&
    isRecord(value.environment) &&
    Array.isArray(value.actor) &&
    value.actor.every(isActorSession) &&
    Array.isArray(value.checks) &&
    value.checks.every(isCheckResult)
  );
}
