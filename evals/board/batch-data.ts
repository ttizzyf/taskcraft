import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  batchFilePath,
  canonicalizeExistingPath,
  loadBatch,
  resolveBatchPath,
  type BatchRecord,
} from "../reporting/batch.ts";
import type { EvalReport } from "../core/types.ts";
import { parseEvalReport } from "../reporting/report.ts";
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
        const paths = resolveSafeReportPaths(
          batchPath,
          attempt.directory,
          reference.jsonPath,
          reference.markdownPath,
        );
        jsonPath = paths.jsonPath;
        markdownPath = paths.markdownPath;
      } catch (error) {
        diagnostics.push({
          filename: label,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      try {
        const report = parseEvalReport(
          JSON.parse(readFileSync(jsonPath, "utf8")) as unknown,
        );
        if (report.caseId !== job.caseId) {
          throw new Error(
            `report case ${report.caseId} does not match job ${job.caseId}`,
          );
        }
        if (report.verdict !== attempt.verdict) {
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

function resolveSafeReportPaths(
  batchPath: string,
  attemptDirectory: string,
  storedJsonPath: string,
  storedMarkdownPath: string,
): { jsonPath: string; markdownPath: string } {
  const batchRoot = dirname(batchPath);
  const realBatchRoot = canonicalizeExistingPath(batchRoot);
  const attemptRoot = resolve(realBatchRoot, attemptDirectory);
  const attemptReal = canonicalizeExistingPath(attemptRoot);
  const expectedAttemptRoot = resolve(
    canonicalizeExistingPath(dirname(attemptRoot)),
    basename(attemptRoot),
  );
  if (attemptReal !== expectedAttemptRoot) {
    throw new Error("batch attempt directory must not be a symlink");
  }
  const jsonPath = resolveBatchPath(batchPath, storedJsonPath);
  const markdownPath = resolveBatchPath(batchPath, storedMarkdownPath);
  const jsonReal = realpathSync(jsonPath);
  const markdownReal = realpathSync(markdownPath);
  if (jsonReal !== jsonPath || markdownReal !== markdownPath) {
    throw new Error("batch report references must not be symlinks");
  }
  if (!pathWithin(attemptReal, jsonReal)) {
    throw new Error("report path is outside its saved attempt directory");
  }
  if (!pathWithin(attemptReal, markdownReal)) {
    throw new Error(
      "markdown report path is outside its saved attempt directory",
    );
  }
  if (!statSync(jsonReal).isFile() || !statSync(markdownReal).isFile()) {
    throw new Error("batch report references must be regular files");
  }
  return { jsonPath: jsonReal, markdownPath: markdownReal };
}

function pathWithin(root: string, target: string): boolean {
  const value = relative(resolve(root), resolve(target));
  return (
    value !== "" &&
    value !== ".." &&
    !value.startsWith(`..${sep}`) &&
    !isAbsolute(value)
  );
}
