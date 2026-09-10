import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  batchFilePath,
  loadBatch,
  resolveBatchPath,
  type BatchRecord,
} from "../reporting/batch.ts";
import type { EvalReport } from "../core/types.ts";
import { isLoadableReport } from "./report.ts";
import type { BoardBatchSummary } from "./batches.ts";

export function toBoardBatchSummary(batch: BatchRecord): BoardBatchSummary {
  const counts = {
    pass: 0,
    fail: 0,
    inconclusive: 0,
    pending: 0,
    running: 0,
  };
  for (const job of batch.jobs) counts[job.status] += 1;
  return {
    id: batch.id,
    status: batch.status,
    createdAt: batch.createdAt,
    caseIds: [...batch.config.caseIds],
    total: batch.jobs.length,
    ...counts,
    diagnostics: [...batch.diagnostics],
  };
}

export interface LoadedBatches {
  records: BatchRecord[];
  reports: EvalReport[];
}

export function loadBatches(
  runDir: string,
  diagnostics: Array<{ filename: string; error: string }>,
): LoadedBatches {
  const batchesRoot = join(runDir, "batches");
  if (!existsSync(batchesRoot)) return { records: [], reports: [] };
  const records: BatchRecord[] = [];
  const reports: EvalReport[] = [];
  let entries;
  try {
    entries = readdirSync(batchesRoot, { withFileTypes: true });
  } catch (error) {
    diagnostics.push({
      filename: "batches",
      error: error instanceof Error ? error.message : String(error),
    });
    return { records, reports };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const batchPath = batchFilePath(runDir, entry.name);
    let batch: BatchRecord;
    try {
      batch = loadBatch(batchPath);
    } catch (error) {
      diagnostics.push({
        filename: `batches/${entry.name}/batch.json`,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    records.push(batch);
    reports.push(...loadBatchReports(batch, batchPath, diagnostics));
  }
  return { records, reports };
}

function loadBatchReports(
  batch: BatchRecord,
  batchPath: string,
  diagnostics: Array<{ filename: string; error: string }>,
): EvalReport[] {
  const reports: EvalReport[] = [];
  for (const job of batch.jobs) {
    if (!batch.config.caseIds.includes(job.caseId)) {
      diagnostics.push({
        filename: `batches/${batch.id}/batch.json`,
        error: `job ${job.id} case is not in the saved batch config`,
      });
      continue;
    }
    for (const attempt of job.attempts) {
      const reference = attempt.report;
      if (reference === null) continue;
      if (attempt.status !== "finished" || attempt.verdict === null) {
        diagnostics.push({
          filename: `batches/${batch.id}/${attempt.directory}`,
          error: "only a finished attempt with a verdict may expose a report",
        });
        continue;
      }
      const label = `batches/${batch.id}/${reference.jsonPath}`;
      let jsonPath: string;
      let markdownPath: string;
      try {
        jsonPath = resolveBatchPath(batchPath, reference.jsonPath);
        markdownPath = resolveBatchPath(batchPath, reference.markdownPath);
        const attemptRoot = resolve(dirname(batchPath), attempt.directory);
        if (!pathWithin(attemptRoot, jsonPath)) {
          throw new Error("report path is outside its saved attempt directory");
        }
        if (!pathWithin(attemptRoot, markdownPath)) {
          throw new Error(
            "markdown report path is outside its saved attempt directory",
          );
        }
      } catch (error) {
        diagnostics.push({
          filename: label,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      try {
        const report = JSON.parse(readFileSync(jsonPath, "utf8")) as unknown;
        if (
          !isRecord(report) ||
          report.schemaVersion !== "tc-eval/v1" ||
          !isLoadableReport(report)
        ) {
          throw new Error("batch report is not a loadable tc-eval/v1 report");
        }
        if (report.caseId !== job.caseId) {
          throw new Error(
            `report case ${report.caseId} does not match job ${job.caseId}`,
          );
        }
        if (attempt.verdict !== null && report.verdict !== attempt.verdict) {
          throw new Error(
            `report verdict ${report.verdict} does not match attempt ${attempt.verdict}`,
          );
        }
        if (!existsSync(markdownPath)) {
          throw new Error("batch markdown report is missing");
        }
        reports.push(report);
      } catch (error) {
        diagnostics.push({
          filename: label,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return reports;
}

function pathWithin(root: string, target: string): boolean {
  const value = relative(resolve(root), resolve(target));
  return value !== "" && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
