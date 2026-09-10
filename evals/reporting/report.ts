import type {
  CheckResult,
  EvalReport,
  HostAdapter,
  Verdict,
} from "../core/types.ts";

const VERDICTS = ["pass", "fail", "inconclusive"] as const;
const HOST_ADAPTERS = ["claude", "pi-sdk"] as const;
const ACTOR_STATUSES = [
  "success",
  "error",
  "timeout",
  "invalid",
  "interrupted",
] as const;
const MODEL_STATUSES = ["not-run", "pass", "fail", "inconclusive"] as const;

export function parseEvalReport(value: unknown): EvalReport {
  const root = record(value, "report");
  enumValue(root.schemaVersion, ["tc-eval/v1"], "report.schemaVersion");
  nonEmptyString(root.caseId, "report.caseId");
  nonEmptyString(root.title, "report.title");
  string(root.summary, "report.summary");
  string(root.startedAt, "report.startedAt");
  string(root.finishedAt, "report.finishedAt");
  string(root.workspace, "report.workspace");
  string(root.requirements, "report.requirements");
  nullableString(root.setupError, "report.setupError");
  optionalNullableString(root.executionError, "report.executionError");
  optionalNullableString(root.gradingError, "report.gradingError");
  optionalNullableString(root.graderError, "report.graderError");
  verdict(root.verdict, "report.verdict");

  array(root.actor, "report.actor").forEach((entry, index) =>
    parseActor(entry, `report.actor[${index}]`),
  );
  array(root.checks, "report.checks").forEach((entry, index) =>
    parseCheck(entry, `report.checks[${index}]`),
  );
  parseModel(root.model, "report.model");
  parseTask(root.task, "report.task");
  nullableString(root.taskReadError, "report.taskReadError");
  parseEnvironment(root.environment, "report.environment");
  if (root.checkpoint !== undefined)
    parseCheckpoint(root.checkpoint, "report.checkpoint");
  if (root.judgeEvidence !== undefined)
    parseJudgeEvidence(root.judgeEvidence, "report.judgeEvidence");
  if (root.provenance !== undefined)
    parseProvenance(root.provenance, "report.provenance");

  const report = value as EvalReport;
  const semanticError = reportVerdictInvariant(report.verdict, report.checks);
  if (semanticError !== null) throw new Error(semanticError);
  return report;
}

export function reportVerdictInvariant(
  declaredVerdict: Verdict,
  checks: readonly CheckResult[],
): string | null {
  const codeChecks = checks.filter((check) => check.grader === "code");
  const modelChecks = checks.filter((check) => check.grader === "model");
  if (declaredVerdict !== "inconclusive" && codeChecks.length === 0) {
    return "terminal report requires at least one code check";
  }
  if (declaredVerdict === "pass") {
    if (codeChecks.some((check) => check.verdict !== "pass")) {
      return "pass report requires every code check to pass";
    }
    if (modelChecks.length === 0) {
      return "pass report requires at least one model check";
    }
    if (modelChecks.some((check) => check.verdict !== "pass")) {
      return "pass report requires every model check to pass";
    }
  }
  if (declaredVerdict === "fail") {
    const hasFailure = checks.some(
      (check) =>
        check.verdict === "fail" &&
        (check.grader === "code" || check.grader === "model"),
    );
    if (!hasFailure)
      return "fail report requires a failing code or model check";
  }
  return null;
}

export function isEvalReport(value: unknown): value is EvalReport {
  try {
    parseEvalReport(value);
    return true;
  } catch {
    return false;
  }
}

function parseActor(value: unknown, label: string): void {
  const root = record(value, label);
  nonEmptyString(root.phase, `${label}.phase`);
  enumValue(root.status, ACTOR_STATUSES, `${label}.status`);
  nonNegativeNumber(root.elapsedMs, `${label}.elapsedMs`);
  nullableNonNegativeInteger(root.callCount, `${label}.callCount`);
  stringArray(root.diagnostics, `${label}.diagnostics`);
  optionalNullableString(root.hostVersion, `${label}.hostVersion`);
  optionalNullableString(root.model, `${label}.model`);
  optionalRecord(root.resultMetadata, `${label}.resultMetadata`);
  optionalHost(root.host, `${label}.host`);
  optionalNullableString(root.requestedModel, `${label}.requestedModel`);
  optionalNullableString(
    root.requestedThinkingLevel,
    `${label}.requestedThinkingLevel`,
  );
  optionalNullableString(root.observedProvider, `${label}.observedProvider`);
  optionalNullableString(root.observedApi, `${label}.observedApi`);
  optionalNullableString(
    root.observedThinkingLevel,
    `${label}.observedThinkingLevel`,
  );
}

function parseCheck(value: unknown, label: string): void {
  const root = record(value, label);
  nonEmptyString(root.id, `${label}.id`);
  enumValue(root.grader, ["code", "model"], `${label}.grader`);
  verdict(root.verdict, `${label}.verdict`);
  string(root.reason, `${label}.reason`);
  stringArray(root.evidence, `${label}.evidence`);
}

function parseModel(value: unknown, label: string): void {
  const root = record(value, label);
  enumValue(root.status, MODEL_STATUSES, `${label}.status`);
  nullableNonNegativeNumber(root.elapsedMs, `${label}.elapsedMs`);
  nullableNonNegativeInteger(root.callCount, `${label}.callCount`);
  stringArray(root.diagnostics, `${label}.diagnostics`);
  optionalHost(root.host, `${label}.host`);
  optionalNullableString(root.requestedModel, `${label}.requestedModel`);
  optionalNullableString(
    root.requestedThinkingLevel,
    `${label}.requestedThinkingLevel`,
  );
  optionalNullableString(root.observedProvider, `${label}.observedProvider`);
  optionalNullableString(root.observedApi, `${label}.observedApi`);
  optionalNullableString(
    root.observedThinkingLevel,
    `${label}.observedThinkingLevel`,
  );
}

function parseTask(value: unknown, label: string): void {
  if (value === null) return;
  const root = record(value, label);
  nonEmptyString(root.taskId, `${label}.taskId`);
  string(root.status, `${label}.status`);
  nonNegativeInteger(root.taskRevision, `${label}.taskRevision`);
  recordArray(root.attempts, `${label}.attempts`);
  recordArray(root.evidence, `${label}.evidence`);
  recordArray(root.facts, `${label}.facts`);
  if (root.findings !== undefined)
    recordArray(root.findings, `${label}.findings`);
  optionalRecord(root.nodeBrief, `${label}.nodeBrief`);
}

function parseEnvironment(value: unknown, label: string): void {
  const root = record(value, label);
  string(root.node, `${label}.node`);
  string(root.host, `${label}.host`);
  nullableString(root.model, `${label}.model`);
  nullableString(root.judgeModel, `${label}.judgeModel`);
  optionalHost(root.hostAdapter, `${label}.hostAdapter`);
  optionalNullableString(
    root.actorThinkingLevel,
    `${label}.actorThinkingLevel`,
  );
  optionalNullableString(
    root.judgeThinkingLevel,
    `${label}.judgeThinkingLevel`,
  );
}

function parseCheckpoint(value: unknown, label: string): void {
  const root = record(value, label);
  boolean(root.established, `${label}.established`);
  parseSourceFiles(root.initialSourceFiles, `${label}.initialSourceFiles`);
  parseSourceFiles(root.sourceFiles, `${label}.sourceFiles`);
  nullableString(root.taskStatus, `${label}.taskStatus`);
  stringArray(root.attemptIds, `${label}.attemptIds`);
  string(root.capturedAt, `${label}.capturedAt`);
  string(root.reason, `${label}.reason`);
}

function parseSourceFiles(value: unknown, label: string): void {
  recordArray(value, label).forEach((entry, index) => {
    const file = entry;
    nonEmptyString(file.path, `${label}[${index}].path`);
    nonEmptyString(file.sha256, `${label}[${index}].sha256`);
    nonNegativeInteger(file.bytes, `${label}[${index}].bytes`);
  });
}

function parseJudgeEvidence(value: unknown, label: string): void {
  const root = record(value, label);
  nonEmptyString(root.kind, `${label}.kind`);
}

function parseProvenance(value: unknown, label: string): void {
  const root = record(value, label);
  nonEmptyString(root.caseFingerprint, `${label}.caseFingerprint`);
  nonEmptyString(root.graderFingerprint, `${label}.graderFingerprint`);
  nonEmptyString(root.comparisonFingerprint, `${label}.comparisonFingerprint`);
  nullableString(root.actorModel, `${label}.actorModel`);
  nullableString(root.judgeModel, `${label}.judgeModel`);
  nullableString(root.hostVersion, `${label}.hostVersion`);
  nonNegativeInteger(root.actorTimeoutMs, `${label}.actorTimeoutMs`);
  nonNegativeInteger(root.judgeTimeoutMs, `${label}.judgeTimeoutMs`);
  nullableString(root.subjectRevision, `${label}.subjectRevision`);
  optionalHost(root.hostAdapter, `${label}.hostAdapter`);
  optionalNullableString(root.actorApi, `${label}.actorApi`);
  optionalNullableString(root.judgeApi, `${label}.judgeApi`);
  optionalNullableString(
    root.actorThinkingLevel,
    `${label}.actorThinkingLevel`,
  );
  optionalNullableString(
    root.judgeThinkingLevel,
    `${label}.judgeThinkingLevel`,
  );
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function recordArray(
  value: unknown,
  label: string,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => record(entry, `${label}[${index}]`));
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value, label).map((entry, index) =>
    string(entry, `${label}[${index}]`),
  );
}

function nonEmptyString(value: unknown, label: string): string {
  const result = string(value, label);
  if (result.trim() === "") throw new Error(`${label} must not be empty`);
  return result;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return string(value, label);
}

function optionalNullableString(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  return string(value, label);
}

function optionalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | null | undefined {
  if (value === undefined || value === null) return value;
  return record(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return value;
}

function nullableNonNegativeNumber(
  value: unknown,
  label: string,
): number | null {
  if (value === null) return null;
  return nonNegativeNumber(value, label);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function nullableNonNegativeInteger(
  value: unknown,
  label: string,
): number | null {
  if (value === null) return null;
  return nonNegativeInteger(value, label);
}

function optionalHost(
  value: unknown,
  label: string,
): HostAdapter | null | undefined {
  if (value === undefined || value === null) return value;
  return enumValue(value, HOST_ADAPTERS, label);
}

function verdict(value: unknown, label: string): Verdict {
  return enumValue(value, VERDICTS, label);
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`${label} has an unsupported value`);
  }
  return value as T;
}
