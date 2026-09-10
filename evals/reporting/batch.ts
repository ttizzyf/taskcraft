import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";

import type { HostAdapter, Verdict } from "../core/types.ts";

export const BATCH_SCHEMA_VERSION = "tc-eval/batch-v1" as const;

export type BatchStatus = "running" | "completed" | "interrupted";
export type BatchJobStatus = "pending" | "running" | Verdict;
export type BatchAttemptStatus = "running" | "finished" | "interrupted";

export interface BatchExecutionConfig {
  caseIds: string[];
  repeat: number;
  concurrency: number;
  actorTimeoutMs: number;
  judgeTimeoutMs: number;
  model: string | null;
  judgeModel: string | null;
  host: HostAdapter;
  cliPath: string;
  repoRoot: string;
}

export interface BatchReportReference {
  jsonPath: string;
  markdownPath: string;
}

export interface BatchJobAttempt {
  attempt: number;
  status: BatchAttemptStatus;
  startedAt: string;
  finishedAt: string | null;
  directory: string;
  pid: number | null;
  verdict: Verdict | null;
  report: BatchReportReference | null;
  diagnostics: string[];
}

export interface BatchJobRecord {
  id: string;
  caseId: string;
  repetition: number;
  status: BatchJobStatus;
  attempts: BatchJobAttempt[];
  diagnostics: string[];
}

export interface BatchRecord {
  schemaVersion: typeof BATCH_SCHEMA_VERSION;
  id: string;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
  config: BatchExecutionConfig;
  jobs: BatchJobRecord[];
  diagnostics: string[];
}

export function batchDirectory(runDir: string, batchId: string): string {
  return join(resolve(runDir), "batches", batchId);
}

export function batchFilePath(runDir: string, batchId: string): string {
  return join(batchDirectory(runDir, batchId), "batch.json");
}

export function parseBatchRecord(value: unknown): BatchRecord {
  const root = record(value, "batch");
  if (root.schemaVersion !== BATCH_SCHEMA_VERSION) {
    throw new Error(
      `unsupported batch schema: ${String(root.schemaVersion ?? "missing")}`,
    );
  }
  const id = nonEmptyString(root.id, "batch.id");
  const status = enumValue(
    root.status,
    ["running", "completed", "interrupted"],
    "batch.status",
  );
  const createdAt = nonEmptyString(root.createdAt, "batch.createdAt");
  const updatedAt = nonEmptyString(root.updatedAt, "batch.updatedAt");
  const config = parseConfig(root.config);
  const rawJobs = array(root.jobs, "batch.jobs");
  const jobs = rawJobs.map((job, index) =>
    parseJob(job, `batch.jobs[${index}]`),
  );
  const ids = new Set<string>();
  for (const job of jobs) {
    if (ids.has(job.id)) throw new Error(`duplicate batch job id: ${job.id}`);
    ids.add(job.id);
    if (
      !config.caseIds.includes(job.caseId) ||
      job.repetition > config.repeat ||
      job.id !== `${job.caseId}-${job.repetition}`
    ) {
      throw new Error(
        `batch job is not present in the saved manifest: ${job.id}`,
      );
    }
  }
  if (jobs.length !== config.caseIds.length * config.repeat) {
    throw new Error(
      `batch.jobs length ${String(jobs.length)} does not match caseIds * repeat`,
    );
  }
  return {
    schemaVersion: BATCH_SCHEMA_VERSION,
    id,
    status,
    createdAt,
    updatedAt,
    config,
    jobs,
    diagnostics: stringArray(root.diagnostics, "batch.diagnostics"),
  };
}

export const parseBatch = parseBatchRecord;

export function loadBatch(batchPath: string): BatchRecord;
export function loadBatch(runDir: string, batchId: string): BatchRecord;
export function loadBatch(pathOrRunDir: string, batchId?: string): BatchRecord {
  const path =
    batchId === undefined ? pathOrRunDir : batchFilePath(pathOrRunDir, batchId);
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read batch ${path}: ${describe(error)}`, {
      cause: error,
    });
  }
  try {
    return parseBatchRecord(JSON.parse(content) as unknown);
  } catch (error) {
    throw new Error(`invalid batch ${path}: ${describe(error)}`, {
      cause: error,
    });
  }
}

export function listBatches(runDir: string): BatchRecord[] {
  const root = join(resolve(runDir), "batches");
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const records: BatchRecord[] = [];
  for (const name of names.sort()) {
    const path = join(root, name, "batch.json");
    try {
      if (statSync(path).isFile()) records.push(loadBatch(path));
    } catch {
      // A partially written or invalid batch is left visible to callers that
      // load it directly, but omitted from a best-effort directory listing.
    }
  }
  return records;
}

export function writeBatchRecord(batchPath: string, batch: BatchRecord): void {
  const validated = parseBatchRecord(batch);
  mkdirSync(dirname(batchPath), { recursive: true });
  writeJsonAtomic(batchPath, validated);
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    const content = `${JSON.stringify(value, null, 2)}\n`;
    writeSync(descriptor, content, undefined, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}

export function resolveBatchPath(
  batchPath: string,
  storedPath: string,
): string {
  if (isAbsolute(storedPath)) {
    throw new Error(`batch path must be relative: ${storedPath}`);
  }
  const root = resolve(dirname(batchPath));
  const candidate = resolve(root, storedPath);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(`batch path escapes batch directory: ${storedPath}`);
  }
  return candidate;
}

export function toBatchRelativePath(
  batchPath: string,
  targetPath: string,
): string {
  const root = resolve(dirname(batchPath));
  const target = resolve(targetPath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`report path escapes batch directory: ${targetPath}`);
  }
  return relative(root, target).split(sep).join("/");
}

function parseConfig(value: unknown): BatchExecutionConfig {
  const root = record(value, "batch.config");
  const caseIds = stringArray(root.caseIds, "batch.config.caseIds");
  const ids = new Set(caseIds);
  if (ids.size !== caseIds.length)
    throw new Error("batch.config.caseIds must not contain duplicates");
  if (caseIds.length === 0)
    throw new Error("batch.config.caseIds must not be empty");
  return {
    caseIds,
    repeat: positiveInteger(root.repeat, "batch.config.repeat"),
    concurrency: positiveInteger(root.concurrency, "batch.config.concurrency"),
    actorTimeoutMs: positiveInteger(
      root.actorTimeoutMs,
      "batch.config.actorTimeoutMs",
    ),
    judgeTimeoutMs: positiveInteger(
      root.judgeTimeoutMs,
      "batch.config.judgeTimeoutMs",
    ),
    model: nullableString(root.model, "batch.config.model"),
    judgeModel: nullableString(root.judgeModel, "batch.config.judgeModel"),
    host: enumValue(root.host, ["claude", "pi-sdk"], "batch.config.host"),
    cliPath: nonEmptyString(root.cliPath, "batch.config.cliPath"),
    repoRoot: nonEmptyString(root.repoRoot, "batch.config.repoRoot"),
  };
}

function parseJob(value: unknown, label: string): BatchJobRecord {
  const root = record(value, label);
  const rawAttempts = array(root.attempts, `${label}.attempts`);
  const attempts = rawAttempts.map((attempt, index) =>
    parseAttempt(attempt, `${label}.attempts[${index}]`),
  );
  const jobStatus = enumValue(
    root.status,
    ["pending", "running", "pass", "fail", "inconclusive"],
    `${label}.status`,
  );
  if (jobStatus === "running" && attempts.at(-1)?.status !== "running") {
    throw new Error(`${label}.status running requires a running attempt`);
  }
  if (
    jobStatus !== "running" &&
    attempts.some((attempt) => attempt.status === "running")
  ) {
    throw new Error(`${label} has a running attempt but is not running`);
  }
  return {
    id: nonEmptyString(root.id, `${label}.id`),
    caseId: nonEmptyString(root.caseId, `${label}.caseId`),
    repetition: positiveInteger(root.repetition, `${label}.repetition`),
    status: jobStatus,
    attempts,
    diagnostics: stringArray(root.diagnostics, `${label}.diagnostics`),
  };
}

function parseAttempt(value: unknown, label: string): BatchJobAttempt {
  const root = record(value, label);
  const reportValue = root.report;
  let report: BatchReportReference | null = null;
  if (reportValue !== null) {
    const reportRoot = record(reportValue, `${label}.report`);
    report = {
      jsonPath: relativeStoredPath(
        reportRoot.jsonPath,
        `${label}.report.jsonPath`,
      ),
      markdownPath: relativeStoredPath(
        reportRoot.markdownPath,
        `${label}.report.markdownPath`,
      ),
    };
  }
  const status = enumValue(
    root.status,
    ["running", "finished", "interrupted"],
    `${label}.status`,
  );
  return {
    attempt: positiveInteger(root.attempt, `${label}.attempt`),
    status,
    startedAt: nonEmptyString(root.startedAt, `${label}.startedAt`),
    finishedAt: nullableString(root.finishedAt, `${label}.finishedAt`),
    directory: relativeStoredPath(root.directory, `${label}.directory`),
    pid: nullableInteger(root.pid, `${label}.pid`),
    verdict:
      root.verdict === null
        ? null
        : enumValue<Verdict>(
            root.verdict,
            ["pass", "fail", "inconclusive"],
            `${label}.verdict`,
          ),
    report,
    diagnostics: stringArray(root.diagnostics, `${label}.diagnostics`),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value, label).map((entry, index) =>
    nonEmptyString(entry, `${label}[${index}]`),
  );
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return nonEmptyString(value, label);
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  return positiveInteger(value, label);
}

function relativeStoredPath(value: unknown, label: string): string {
  const path = nonEmptyString(value, label);
  if (isAbsolute(path)) throw new Error(`${label} must be relative`);
  const normalized = normalize(path);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`)
  ) {
    throw new Error(`${label} must stay within the batch directory`);
  }
  return normalized.split(sep).join("/");
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function reportExists(
  batchPath: string,
  reference: BatchReportReference,
): boolean {
  try {
    return (
      existsSync(resolveBatchPath(batchPath, reference.jsonPath)) &&
      existsSync(resolveBatchPath(batchPath, reference.markdownPath))
    );
  } catch {
    return false;
  }
}
