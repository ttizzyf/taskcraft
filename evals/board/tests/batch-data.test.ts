import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { EvalReport } from "../../core/types.ts";
import { writeBatchRecord, type BatchRecord } from "../../reporting/batch.ts";
import { loadBoardData } from "../data.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("evals board batch report loading", () => {
  it("loads batch summaries and safely exposes referenced internal reports", () => {
    const tempDir = join(tmpdir(), `evals-board-batch-test-${Date.now()}`);
    roots.push(tempDir);
    const batchId = "batch-board-integration";
    const batchPath = join(tempDir, "batches", batchId, "batch.json");
    const attemptDir = join(
      tempDir,
      "batches",
      batchId,
      "jobs",
      "delivery-1",
      "attempt-1",
    );
    mkdirSync(attemptDir, { recursive: true });
    const report: EvalReport = {
      schemaVersion: "tc-eval/v1",
      caseId: "delivery",
      title: "Delivery",
      verdict: "pass",
      summary: "batch report",
      startedAt: "2026-09-10T10:00:00.000Z",
      finishedAt: "2026-09-10T10:00:01.000Z",
      workspace: "/tmp/batch-workspace",
      requirements: "req",
      setupError: null,
      executionError: null,
      gradingError: null,
      graderError: null,
      actor: [
        {
          phase: "delivery-actor",
          status: "success",
          elapsedMs: 1,
          callCount: 1,
          diagnostics: [],
          hostVersion: null,
          model: null,
          resultMetadata: null,
        },
      ],
      checks: [
        {
          id: "csv-functional",
          grader: "code",
          verdict: "pass",
          reason: "ok",
          evidence: ["fixture"],
        },
      ],
      model: {
        status: "pass",
        elapsedMs: null,
        callCount: null,
        diagnostics: [],
      },
      task: null,
      taskReadError: null,
      environment: {
        node: "24",
        host: "fake",
        model: null,
        judgeModel: null,
      },
    };
    writeFileSync(
      join(attemptDir, "report.json"),
      JSON.stringify(report),
      "utf8",
    );
    writeFileSync(join(attemptDir, "report.md"), "# batch report\n", "utf8");
    const batch: BatchRecord = {
      schemaVersion: "tc-eval/batch-v1",
      id: batchId,
      status: "completed",
      createdAt: "2026-09-10T10:00:00.000Z",
      updatedAt: "2026-09-10T10:00:01.000Z",
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
          status: "pass",
          attempts: [
            {
              attempt: 1,
              status: "finished",
              startedAt: "2026-09-10T10:00:00.000Z",
              finishedAt: "2026-09-10T10:00:01.000Z",
              directory: "jobs/delivery-1/attempt-1",
              pid: null,
              verdict: "pass",
              report: {
                jsonPath: "jobs/delivery-1/attempt-1/report.json",
                markdownPath: "jobs/delivery-1/attempt-1/report.md",
              },
              diagnostics: [],
            },
          ],
          diagnostics: [],
        },
      ],
      diagnostics: [],
    };
    writeBatchRecord(batchPath, batch);

    const data = loadBoardData(tempDir);
    expect(data.batches).toHaveLength(1);
    expect(data.batches?.[0]).toMatchObject({
      id: batchId,
      total: 1,
      pass: 1,
      fail: 0,
      inconclusive: 0,
      pending: 0,
      running: 0,
    });
    expect(data.reports).toHaveLength(1);
    expect(
      data.scenarios.find((scenario) => scenario.id === "delivery")?.status,
    ).toBe("pass");
  });
});
