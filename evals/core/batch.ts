import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";

import { findCase } from "../cases/index.ts";
import {
  batchFilePath,
  loadBatch,
  writeBatchRecord,
  type BatchExecutionConfig,
  type BatchJobRecord,
  type BatchRecord,
} from "../reporting/batch.ts";
import { acquireBatchLock } from "./batch-lock.ts";
import {
  finishBatchJob,
  interruptBatchJob,
  recoverBatchJobs,
  startBatchJob,
  type ActiveBatchJob,
} from "./batch-jobs.ts";
import type { HostAdapter, Verdict } from "./types.ts";

const DEFAULT_ACTOR_TIMEOUT_MS = 180_000;
const DEFAULT_JUDGE_TIMEOUT_MS = 60_000;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_REPEAT = 1;

export interface RunBatchOptions {
  runDir?: string;
  caseIds?: readonly string[];
  repeat?: number;
  concurrency?: number;
  actorTimeoutMs?: number;
  judgeTimeoutMs?: number;
  model?: string;
  judgeModel?: string;
  host?: HostAdapter;
  cliPath?: string;
  resumeBatchId?: string;
  batchId?: string;
  workerPath?: string;
  signal?: AbortSignal;
}

export interface RunBatchResult {
  batch: BatchRecord;
  batchPath: string;
}

interface PreparedBatch {
  batch: BatchRecord;
  batchPath: string;
  isNew: boolean;
}

type ActiveJobMap = Map<string, ActiveBatchJob>;

export async function runBatch(
  options: RunBatchOptions,
): Promise<RunBatchResult> {
  const runDir = resolve(
    options.runDir ?? join(process.cwd(), "evals", "runs"),
  );
  const prepared =
    options.resumeBatchId === undefined
      ? createNewBatch(options, runDir)
      : loadResumeBatch(options, runDir);
  const lock = acquireBatchLock(prepared.batchPath);
  const batch = prepared.batch;
  const active: ActiveJobMap = new Map();
  let stopReason: string | null = null;
  let signalHandler: (() => void) | undefined;

  const persist = (): void => {
    batch.updatedAt = new Date().toISOString();
    writeBatchRecord(prepared.batchPath, batch);
  };
  const requestStop = (reason: string): void => {
    if (stopReason !== null) return;
    stopReason = reason;
    batch.diagnostics.push(reason);
    for (const entry of active.values()) entry.handle.cancel();
  };

  try {
    if (prepared.isNew) writeBatchRecord(prepared.batchPath, batch);
    await recoverBatchJobs(batch, prepared.batchPath);
    persist();

    signalHandler = () => requestStop("batch cancellation requested");
    if (options.signal?.aborted === true)
      requestStop("batch cancellation requested");
    else
      options.signal?.addEventListener("abort", signalHandler, { once: true });
    process.once("SIGINT", signalHandler);
    process.once("SIGTERM", signalHandler);

    if (stopReason === null) {
      await schedule(
        batch,
        prepared.batchPath,
        options.workerPath,
        active,
        persist,
        requestStop,
        () => stopReason !== null,
      );
    }
    if (active.size > 0) {
      requestStop(stopReason ?? "batch cancellation requested");
      await Promise.all(
        [...active.entries()].map(async ([jobId, entry]) => {
          const result = await entry.handle.result;
          active.delete(jobId);
          finishBatchJob(prepared.batchPath, entry, result);
        }),
      );
    }
    batch.status = stopReason === null ? "completed" : "interrupted";
    persist();
    return { batch, batchPath: prepared.batchPath };
  } catch (error) {
    const diagnostic = `batch controller failed: ${describe(error)}`;
    batch.diagnostics.push(diagnostic);
    await stopActiveJobs(active, diagnostic);
    batch.status = "interrupted";
    try {
      persist();
    } catch {
      // Preserve the controller error if the filesystem is unavailable.
    }
    throw error;
  } finally {
    if (signalHandler !== undefined) {
      options.signal?.removeEventListener("abort", signalHandler);
      process.removeListener("SIGINT", signalHandler);
      process.removeListener("SIGTERM", signalHandler);
    }
    lock.release();
  }
}

export function expandBatchJobs(
  caseIds: readonly string[],
  repeat: number,
): BatchJobRecord[] {
  validatePositiveInteger(repeat, "repeat");
  if (caseIds.length === 0)
    throw new Error("at least one eval case is required");
  const seen = new Set<string>();
  for (const caseId of caseIds) {
    if (typeof caseId !== "string" || caseId.trim() === "") {
      throw new Error("case ids must be non-empty strings");
    }
    if (seen.has(caseId)) throw new Error(`duplicate eval case: ${caseId}`);
    seen.add(caseId);
    if (findCase(caseId) === undefined)
      throw new Error(`unknown eval case: ${caseId}`);
  }
  const jobs: BatchJobRecord[] = [];
  for (const caseId of caseIds) {
    for (let repetition = 1; repetition <= repeat; repetition += 1) {
      jobs.push({
        id: `${caseId}-${repetition}`,
        caseId,
        repetition,
        status: "pending",
        attempts: [],
        diagnostics: [],
      });
    }
  }
  return jobs;
}

export function parseCaseIds(value: string): string[] {
  const caseIds = value
    .split(",")
    .map((caseId) => caseId.trim())
    .filter((caseId) => caseId !== "");
  if (caseIds.length === 0)
    throw new Error("--cases requires at least one case id");
  const seen = new Set<string>();
  for (const caseId of caseIds) {
    if (seen.has(caseId)) throw new Error(`duplicate eval case: ${caseId}`);
    seen.add(caseId);
  }
  return caseIds;
}

function createNewBatch(
  options: RunBatchOptions,
  runDir: string,
): PreparedBatch {
  if (options.resumeBatchId !== undefined) {
    throw new Error("resumeBatchId cannot be used while creating a batch");
  }
  if (options.caseIds === undefined)
    throw new Error("batch case selection is required");
  const repeat = options.repeat ?? DEFAULT_REPEAT;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const config = buildConfig(options, options.caseIds, repeat, concurrency);
  const id = options.batchId ?? createBatchId();
  const batchPath = batchFilePath(runDir, id);
  if (existsSync(batchPath)) throw new Error(`batch already exists: ${id}`);
  const now = new Date().toISOString();
  return {
    batch: {
      schemaVersion: "tc-eval/batch-v1",
      id,
      status: "running",
      createdAt: now,
      updatedAt: now,
      config,
      jobs: expandBatchJobs(config.caseIds, config.repeat),
      diagnostics: [],
    },
    batchPath,
    isNew: true,
  };
}

function loadResumeBatch(
  options: RunBatchOptions,
  runDir: string,
): PreparedBatch {
  const batchId = options.resumeBatchId;
  if (batchId === undefined || batchId.trim() === "") {
    throw new Error("resumeBatchId is required");
  }
  if (options.batchId !== undefined)
    throw new Error("--resume cannot create a new batch");
  const batchPath = batchFilePath(runDir, batchId);
  const batch = loadBatch(batchPath);
  const overrides: Array<[string, unknown]> = [
    ["caseIds", options.caseIds],
    ["repeat", options.repeat],
    ["concurrency", options.concurrency],
    ["actorTimeoutMs", options.actorTimeoutMs],
    ["judgeTimeoutMs", options.judgeTimeoutMs],
    ["model", options.model],
    ["judgeModel", options.judgeModel],
    ["host", options.host],
    ["cliPath", options.cliPath],
  ];
  const changed = overrides.find(([, value]) => value !== undefined);
  if (changed !== undefined) {
    throw new Error(
      `--resume cannot modify saved execution config (${changed[0]})`,
    );
  }
  if (
    batch.status === "completed" &&
    batch.jobs.some((job) => !isTerminal(job.status))
  ) {
    throw new Error("completed batch contains unfinished jobs");
  }
  return { batch, batchPath, isNew: false };
}

function buildConfig(
  options: RunBatchOptions,
  caseIds: readonly string[],
  repeat: number,
  concurrency: number,
): BatchExecutionConfig {
  validatePositiveInteger(repeat, "repeat");
  validatePositiveInteger(concurrency, "concurrency");
  const actorTimeoutMs = options.actorTimeoutMs ?? DEFAULT_ACTOR_TIMEOUT_MS;
  const judgeTimeoutMs = options.judgeTimeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS;
  validatePositiveInteger(actorTimeoutMs, "actor-timeout-ms");
  validatePositiveInteger(judgeTimeoutMs, "judge-timeout-ms");
  const host = options.host ?? "claude";
  if (host !== "claude" && host !== "pi-sdk")
    throw new Error(`unknown host adapter: ${host}`);
  return {
    caseIds: [...caseIds],
    repeat,
    concurrency,
    actorTimeoutMs,
    judgeTimeoutMs,
    model: options.model ?? null,
    judgeModel: options.judgeModel ?? null,
    host,
    cliPath: resolve(options.cliPath ?? join(process.cwd(), "dist", "cli.js")),
    repoRoot: process.cwd(),
  };
}

async function schedule(
  batch: BatchRecord,
  batchPath: string,
  workerPath: string | undefined,
  active: ActiveJobMap,
  persist: () => void,
  requestStop: (reason: string) => void,
  shouldStop: () => boolean,
): Promise<void> {
  while (true) {
    while (!shouldStop() && active.size < batch.config.concurrency) {
      const job = batch.jobs.find(
        (candidate) => candidate.status === "pending",
      );
      if (job === undefined) break;
      active.set(job.id, startBatchJob(batch, batchPath, job, workerPath));
      persist();
    }
    if (active.size === 0) return;
    const completed = await Promise.race(
      [...active.entries()].map(async ([jobId, entry]) => ({
        jobId,
        entry,
        result: await entry.handle.result,
      })),
    );
    active.delete(completed.jobId);
    finishBatchJob(batchPath, completed.entry, completed.result);
    persist();
    if (completed.result.kind === "cancelled")
      requestStop("job cancellation requested");
  }
}

async function stopActiveJobs(
  active: ActiveJobMap,
  diagnostic: string,
): Promise<void> {
  const entries = [...active.entries()];
  for (const [, entry] of entries) entry.handle.cancel();
  await Promise.allSettled(entries.map(([, entry]) => entry.handle.result));
  for (const [, entry] of entries)
    interruptBatchJob(entry.job, entry.attempt, diagnostic);
  active.clear();
}

function createBatchId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `batch-${stamp}-${randomBytes(4).toString("hex")}`;
}

function isTerminal(status: string): status is Verdict {
  return status === "pass" || status === "fail" || status === "inconclusive";
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
