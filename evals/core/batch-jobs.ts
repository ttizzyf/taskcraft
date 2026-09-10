import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  toBatchRelativePath,
  type BatchJobAttempt,
  type BatchJobRecord,
  type BatchRecord,
} from "../reporting/batch.ts";
import {
  isProcessAlive,
  readJobResult,
  spawnEvalJob,
  stopProcessTree,
  type JobProcessHandle,
  type JobProcessResult,
  type JobReportPaths,
} from "./job.ts";
import type { Verdict } from "./types.ts";

export interface ActiveBatchJob {
  job: BatchJobRecord;
  attempt: BatchJobAttempt;
  handle: JobProcessHandle;
}

export function startBatchJob(
  batch: BatchRecord,
  batchPath: string,
  job: BatchJobRecord,
  workerPath: string | undefined,
): ActiveBatchJob {
  const attemptNumber = (job.attempts.at(-1)?.attempt ?? 0) + 1;
  const directory = `jobs/${job.id}/attempt-${String(attemptNumber)}`;
  const attemptDir = resolve(dirname(batchPath), directory);
  mkdirSync(attemptDir, { recursive: true });
  const attempt: BatchJobAttempt = {
    attempt: attemptNumber,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    directory,
    pid: null,
    verdict: null,
    report: null,
    diagnostics: [],
  };
  job.attempts.push(attempt);
  job.status = "running";
  const handle = spawnEvalJob(
    {
      protocol: "tc-eval/job-v1",
      jobId: job.id,
      caseId: job.caseId,
      repetition: job.repetition,
      attempt: attemptNumber,
      attemptDir,
      cliPath: batch.config.cliPath,
      repoRoot: batch.config.repoRoot,
      host: batch.config.host,
      model: batch.config.model,
      judgeModel: batch.config.judgeModel,
      actorTimeoutMs: batch.config.actorTimeoutMs,
      judgeTimeoutMs: batch.config.judgeTimeoutMs,
    },
    workerPath,
  );
  attempt.pid = handle.pid;
  return { job, attempt, handle };
}

export function finishBatchJob(
  batchPath: string,
  entry: ActiveBatchJob,
  result: JobProcessResult,
): void {
  if (result.kind === "cancelled") {
    interruptBatchJob(
      entry.job,
      entry.attempt,
      result.diagnostics.join("; ") || "job cancelled",
    );
    return;
  }
  const attempt = entry.attempt;
  attempt.pid = null;
  attempt.finishedAt = new Date().toISOString();
  attempt.status = "finished";
  if (result.kind === "crashed") {
    settleAsInconclusive(entry.job, attempt, result.diagnostics);
    return;
  }
  if (
    result.payload.jobId !== entry.job.id ||
    result.payload.attempt !== attempt.attempt
  ) {
    settleAsInconclusive(entry.job, attempt, [
      "job result does not match its persisted job attempt",
    ]);
    return;
  }
  if (result.payload.status === "error") {
    settleAsInconclusive(entry.job, attempt, result.payload.diagnostics);
    return;
  }
  const payload = result.payload;
  if (payload.verdict === null || payload.report === null) {
    settleAsInconclusive(entry.job, attempt, [
      "job result omitted verdict or report",
    ]);
    return;
  }
  const report = validateBatchReport(
    batchPath,
    entry.job,
    attempt,
    payload.report,
    payload.verdict,
  );
  if (report === null) {
    settleAsInconclusive(entry.job, attempt, [
      "job report is missing, invalid, or unrelated",
    ]);
    return;
  }
  attempt.verdict = payload.verdict;
  attempt.report = report;
  attempt.diagnostics.push(...payload.diagnostics);
  entry.job.status = payload.verdict;
  entry.job.diagnostics.push(...payload.diagnostics);
}

export async function recoverBatchJobs(
  batch: BatchRecord,
  batchPath: string,
): Promise<void> {
  for (const job of batch.jobs) {
    if (job.status !== "running") continue;
    const attempt = job.attempts.at(-1);
    if (attempt === undefined) {
      job.status = "pending";
      job.diagnostics.push("running job had no attempt; queued for resume");
      continue;
    }
    const attemptDir = resolve(dirname(batchPath), attempt.directory);
    const recovered = readJobResult(attemptDir);
    const matchesAttempt =
      recovered !== null &&
      recovered.jobId === job.id &&
      recovered.attempt === attempt.attempt;
    if (matchesAttempt && isProcessAlive(attempt.pid)) {
      await stopProcessTree(attempt.pid);
    }
    if (matchesAttempt && recovered.status === "error") {
      attempt.status = "finished";
      attempt.finishedAt = attempt.finishedAt ?? new Date().toISOString();
      attempt.pid = null;
      settleAsInconclusive(job, attempt, recovered.diagnostics);
      continue;
    }
    if (
      matchesAttempt &&
      recovered.status === "finished" &&
      recovered.verdict !== null &&
      recovered.report !== null
    ) {
      const report = validateBatchReport(
        batchPath,
        job,
        attempt,
        recovered.report,
        recovered.verdict,
      );
      if (report !== null) {
        attempt.status = "finished";
        attempt.finishedAt = attempt.finishedAt ?? new Date().toISOString();
        attempt.pid = null;
        attempt.verdict = recovered.verdict;
        attempt.report = report;
        attempt.diagnostics.push(
          ...recovered.diagnostics,
          "recovered completed job result",
        );
        job.status = recovered.verdict;
        continue;
      }
    }
    if (isProcessAlive(attempt.pid)) await stopProcessTree(attempt.pid);
    interruptBatchJob(
      job,
      attempt,
      "previous batch controller ended before job completion",
    );
  }
}

export function interruptBatchJob(
  job: BatchJobRecord,
  attempt: BatchJobAttempt,
  diagnostic: string,
): void {
  attempt.status = "interrupted";
  attempt.finishedAt = new Date().toISOString();
  attempt.pid = null;
  attempt.diagnostics.push(diagnostic);
  job.status = "pending";
  job.diagnostics.push(diagnostic);
}

function validateBatchReport(
  batchPath: string,
  job: BatchJobRecord,
  attempt: BatchJobAttempt,
  paths: JobReportPaths,
  verdict: Verdict,
): { jsonPath: string; markdownPath: string } | null {
  try {
    const attemptRoot = resolve(dirname(batchPath), attempt.directory);
    const jsonPath = resolveReportInAttempt(attemptRoot, paths.jsonPath);
    const markdownPath = resolveReportInAttempt(
      attemptRoot,
      paths.markdownPath,
    );
    if (!existsSync(jsonPath) || !existsSync(markdownPath)) return null;
    const report = JSON.parse(readFileSync(jsonPath, "utf8")) as unknown;
    if (
      !isRecord(report) ||
      report.caseId !== job.caseId ||
      report.verdict !== verdict
    ) {
      return null;
    }
    return {
      jsonPath: toBatchRelativePath(batchPath, jsonPath),
      markdownPath: toBatchRelativePath(batchPath, markdownPath),
    };
  } catch {
    return null;
  }
}

function resolveReportInAttempt(
  attemptRoot: string,
  storedPath: string,
): string {
  const candidate = resolve(attemptRoot, storedPath);
  const root = resolve(attemptRoot);
  if (candidate !== root && !candidate.startsWith(`${root}${separator()}`)) {
    throw new Error("report path escapes attempt directory");
  }
  return candidate;
}

function settleAsInconclusive(
  job: BatchJobRecord,
  attempt: BatchJobAttempt,
  diagnostics: readonly string[],
): void {
  const messages =
    diagnostics.length > 0
      ? [...diagnostics]
      : ["job harness failed without diagnostics"];
  attempt.verdict = "inconclusive";
  attempt.diagnostics.push(...messages);
  job.diagnostics.push(...messages);
  job.status = "inconclusive";
}

function separator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
