import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { runBatch } from "../core/batch.ts";
import { isProcessAlive } from "../core/job.ts";
import {
  loadBatch,
  parseBatch,
  writeBatchRecord,
  type BatchRecord,
} from "../reporting/batch.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("batch persistence and scheduling", () => {
  it("expands repeats, respects concurrency, and links each report to its job", async () => {
    const fixture = fixtureWorker("normal");
    const result = await runBatch({
      runDir: fixture.runDir,
      caseIds: ["delivery", "recovery"],
      repeat: 2,
      concurrency: 2,
      actorTimeoutMs: 1_000,
      judgeTimeoutMs: 1_000,
      workerPath: fixture.workerPath,
    });

    expect(result.batch.status).toBe("completed");
    expect(result.batch.jobs).toHaveLength(4);
    expect(result.batch.jobs.every((job) => job.status === "pass")).toBe(true);
    expect(result.batch.config.repeat).toBe(2);
    expect(result.batch.config.concurrency).toBe(2);
    expect(loadBatch(result.batchPath).id).toBe(result.batch.id);
    expect(maxConcurrent(fixture.logPath)).toBeLessThanOrEqual(2);
    for (const job of result.batch.jobs) {
      const attempt = job.attempts[0];
      expect(attempt?.report).not.toBeNull();
      expect(attempt?.report?.jsonPath).toContain(`jobs/${job.id}/attempt-1/`);
      expect(
        existsSync(
          join(dirname(result.batchPath), attempt?.report?.jsonPath ?? ""),
        ),
      ).toBe(true);
    }
  });

  it("isolates terminal failures and does not rerun them on resume", async () => {
    const fixture = fixtureWorker("fail-recovery");
    const first = await runBatch({
      runDir: fixture.runDir,
      caseIds: ["delivery", "recovery"],
      concurrency: 2,
      workerPath: fixture.workerPath,
    });
    const callsAfterFirstRun = lines(fixture.logPath).length;
    expect(first.batch.jobs.map((job) => job.status)).toEqual(["pass", "fail"]);

    const resumed = await runBatch({
      runDir: fixture.runDir,
      resumeBatchId: first.batch.id,
      workerPath: fixture.workerPath,
    });
    expect(resumed.batch.status).toBe("completed");
    expect(lines(fixture.logPath)).toHaveLength(callsAfterFirstRun);
    expect(resumed.batch.jobs.every((job) => job.attempts.length === 1)).toBe(
      true,
    );
  });

  it("records a harness crash as inconclusive and keeps it terminal", async () => {
    const fixture = fixtureWorker("crash");
    const first = await runBatch({
      runDir: fixture.runDir,
      caseIds: ["delivery"],
      workerPath: fixture.workerPath,
    });
    expect(first.batch.jobs[0]?.status).toBe("inconclusive");
    expect(first.batch.jobs[0]?.diagnostics.join(" ")).toContain(
      "no valid protocol",
    );

    const resumed = await runBatch({
      runDir: fixture.runDir,
      resumeBatchId: first.batch.id,
      workerPath: fixture.workerPath,
    });
    expect(resumed.batch.jobs[0]?.status).toBe("inconclusive");
    expect(resumed.batch.jobs[0]?.attempts).toHaveLength(1);
  });

  it("stops dispatching on abort and resumes only unfinished jobs", async () => {
    const fixture = fixtureWorker("resume");
    const controller = new AbortController();
    const running = runBatch({
      runDir: fixture.runDir,
      caseIds: ["delivery"],
      repeat: 2,
      concurrency: 1,
      workerPath: fixture.workerPath,
      signal: controller.signal,
    });
    await waitFor(() => hasEvent(fixture.logPath, "finish", "delivery-1"));
    await waitFor(() => hasEvent(fixture.logPath, "start", "delivery-2"));
    controller.abort();
    const interrupted = await running;
    expect(interrupted.batch.status).toBe("interrupted");
    expect(interrupted.batch.jobs[0]?.status).toBe("pass");
    expect(interrupted.batch.jobs[1]?.status).toBe("pending");
    expect(interrupted.batch.jobs[1]?.attempts[0]?.status).toBe("interrupted");

    const resumed = await runBatch({
      runDir: fixture.runDir,
      resumeBatchId: interrupted.batch.id,
      workerPath: fixture.workerPath,
    });
    expect(resumed.batch.status).toBe("completed");
    expect(resumed.batch.jobs[0]?.attempts).toHaveLength(1);
    expect(resumed.batch.jobs[1]?.attempts).toHaveLength(2);
    expect(resumed.batch.jobs[1]?.attempts[1]?.report).not.toBeNull();
  });

  it("rejects a second dispatcher while the first owner is active", async () => {
    const fixture = fixtureWorker("long");
    const controller = new AbortController();
    const running = runBatch({
      runDir: fixture.runDir,
      caseIds: ["delivery"],
      workerPath: fixture.workerPath,
      signal: controller.signal,
    });
    await waitFor(() => hasEvent(fixture.logPath, "start", "delivery-1"));
    const batchId = findBatchId(fixture.runDir);
    await expect(
      runBatch({
        runDir: fixture.runDir,
        resumeBatchId: batchId,
        workerPath: fixture.workerPath,
      }),
    ).rejects.toThrow("already active");
    controller.abort();
    await running;
  });

  it("terminates a worker's detached descendant on cancellation", async () => {
    const fixture = fixtureWorker("descendant");
    const controller = new AbortController();
    const running = runBatch({
      runDir: fixture.runDir,
      caseIds: ["delivery"],
      workerPath: fixture.workerPath,
      signal: controller.signal,
    });
    await waitFor(() => existsSync(fixture.markerPath));
    const pid = Number(readFileSync(fixture.markerPath, "utf8"));
    controller.abort();
    const result = await running;
    expect(result.batch.status).toBe("interrupted");
    await waitFor(() => !isProcessAlive(pid));
  });
});

describe("batch schema", () => {
  it("round-trips through the public parser and rejects a mismatched manifest", () => {
    const fixture = fixtureWorker("normal");
    const batch: BatchRecord = {
      schemaVersion: "tc-eval/batch-v1",
      id: "batch-test",
      status: "completed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: {
        caseIds: ["delivery"],
        repeat: 1,
        concurrency: 1,
        actorTimeoutMs: 1_000,
        judgeTimeoutMs: 1_000,
        model: null,
        judgeModel: null,
        host: "claude",
        cliPath: "/tmp/tc.js",
        repoRoot: "/tmp/repo",
      },
      jobs: [
        {
          id: "delivery-1",
          caseId: "delivery",
          repetition: 1,
          status: "pending",
          attempts: [],
          diagnostics: [],
        },
      ],
      diagnostics: [],
    };
    const path = join(fixture.runDir, "batches", "batch-test", "batch.json");
    writeBatchRecord(path, batch);
    expect(
      parseBatch(JSON.parse(readFileSync(path, "utf8")) as unknown).id,
    ).toBe("batch-test");
    expect(() => parseBatch({ ...batch, jobs: [] })).toThrow(/jobs length/);
  });
});

interface Fixture {
  runDir: string;
  workerPath: string;
  logPath: string;
  markerPath: string;
}

function fixtureWorker(mode: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), "taskcraft-batch-test-"));
  roots.push(root);
  const runDir = join(root, "runs");
  const logPath = join(root, "events.log");
  const markerPath = join(root, "descendant.pid");
  const workerPath = join(root, "worker.mjs");
  writeFileSync(workerPath, workerSource(mode, logPath, markerPath), "utf8");
  chmodSync(workerPath, 0o755);
  return { runDir, workerPath, logPath, markerPath };
}

function workerSource(
  mode: string,
  logPath: string,
  markerPath: string,
): string {
  return `import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
const mode = ${JSON.stringify(mode)};
const logPath = ${JSON.stringify(logPath)};
const markerPath = ${JSON.stringify(markerPath)};
const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const event = (kind) => appendFileSync(logPath, JSON.stringify({ kind, jobId: request.jobId }) + "\\n");
event("start");
if (mode === "crash") process.exit(7);
if (mode === "descendant") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  writeFileSync(markerPath, String(child.pid));
  const stop = () => { try { process.kill(child.pid, "SIGTERM"); } catch {} process.exit(143); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  setInterval(() => {}, 1000);
} else {
  const delay = mode === "resume" ? (request.repetition === 1 ? 20 : 5000) : mode === "long" ? 5000 : 40;
  await new Promise((resolve) => setTimeout(resolve, delay));
  const verdict = mode === "fail-recovery" && request.caseId === "recovery" ? "fail" : "pass";
  mkdirSync(request.attemptDir, { recursive: true });
  const report = { caseId: request.caseId, verdict };
  const jsonPath = join(request.attemptDir, "report.json");
  const markdownPath = join(request.attemptDir, "report.md");
  writeFileSync(jsonPath, JSON.stringify(report));
  writeFileSync(markdownPath, "# fake report\\n");
  const payload = { protocol: "tc-eval/job-v1", jobId: request.jobId, attempt: request.attempt, status: "finished", verdict, report: { jsonPath, markdownPath }, diagnostics: [] };
  writeFileSync(join(request.attemptDir, "result.json"), JSON.stringify(payload));
  event("finish");
  process.stdout.write(JSON.stringify(payload) + "\\n");
}`;
}

function lines(path: string): Array<{ kind: string; jobId: string }> {
  try {
    return readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { kind: string; jobId: string });
  } catch {
    return [];
  }
}

function maxConcurrent(path: string): number {
  let current = 0;
  let maximum = 0;
  for (const event of lines(path)) {
    current += event.kind === "start" ? 1 : -1;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function hasEvent(path: string, kind: string, jobId: string): boolean {
  return lines(path).some(
    (event) => event.kind === kind && event.jobId === jobId,
  );
}

function findBatchId(runDir: string): string {
  const path = join(runDir, "batches");
  const entries = readdirSync(path);
  if (entries.length !== 1)
    throw new Error(`expected one batch, found ${entries.length}`);
  return entries[0] ?? "";
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for batch fixture");
}
