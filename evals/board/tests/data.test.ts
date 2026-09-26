import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeReportComparison, loadBoardData } from "../data.ts";
import type { EvalReport } from "../../core/types.ts";
import { blockedLegacyReport } from "./fixtures/blocked-legacy-report.ts";

describe("evals board-data loader and comparison", () => {
  // Keep synthetic fixture reports out of the real evals/runs directory.
  const tempDir = join(tmpdir(), `evals-board-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const LEGACY_REPORT = "delivery-2026-09-09T11-29-30-582Z.json";

  /** The historical report is a git-ignored run artifact, so it only exists on
   * the machine that produced it. Prefer the real file when present and fall
   * back to a fixture with the same observable shape — one delivery attempt
   * that never completed, carrying the `unrecognized_model` warning — so the
   * board's blocked/derived-inconclusive behaviour is asserted identically on
   * every checkout and platform. */
  function legacyRunsDir(): string {
    const directory = join(tempDir, "legacy-runs");
    mkdirSync(directory, { recursive: true });
    const source = join(process.cwd(), "evals", "runs", LEGACY_REPORT);
    if (existsSync(source)) {
      copyFileSync(source, join(directory, LEGACY_REPORT));
      return directory;
    }
    writeFileSync(
      join(directory, LEGACY_REPORT),
      `${JSON.stringify(blockedLegacyReport(), null, 2)}\n`,
    );
    return directory;
  }

  it("loads existing delivery report correctly with 1 blocked attempt and 2 unrun scenarios", () => {
    const realRunsDir = legacyRunsDir();
    const data = loadBoardData(realRunsDir);

    expect(data.overview.totalScenarios).toBe(3);
    expect(data.overview.attemptedScenarios).toBe(1);
    expect(data.overview.decisiveScenarios).toBe(0);
    expect(data.overview.blockedScenarios).toBe(1);
    expect(data.overview.unrunScenarios).toBe(2);

    const delivery = data.scenarios.find((s) => s.id === "delivery");
    expect(delivery).toBeDefined();
    expect(delivery?.status).toBe("blocked");
    expect(delivery?.displayStatus).toBe("执行受阻");
    expect(delivery?.latestRun?.isBlocked).toBe(true);
    expect(delivery?.latestRun?.oneLineReason).toContain(
      "执行未完成，尚无可验收结果",
    );

    // Downstream checks must be derived inconclusive, not 5 independent red defects
    const checks = delivery?.latestRun?.checks ?? [];
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      expect(check.displayVerdict).toBe("无法判定");
      expect(check.isDerivedInconclusive).toBe(true);
      expect(check.reason).toContain("无法判定：前置执行未完成");
    }

    // Unrun scenarios
    const recovery = data.scenarios.find((s) => s.id === "recovery");
    expect(recovery?.status).toBe("unrun");
    expect(recovery?.displayStatus).toBe("未运行");
    expect(recovery?.runCount).toBe(0);

    const review = data.scenarios.find((s) => s.id === "review");
    expect(review?.status).toBe("unrun");
    expect(review?.displayStatus).toBe("未运行");
  });

  it("detects unrecognized_model diagnostic warning without diagnosing root cause", () => {
    const realRunsDir = legacyRunsDir();
    const data = loadBoardData(realRunsDir);
    const delivery = data.scenarios.find((s) => s.id === "delivery");
    const actorSessions = delivery?.latestRun?.actorSessions ?? [];
    expect(actorSessions.length).toBe(1);
    expect(actorSessions[0]?.hasUnrecognizedModelWarning).toBe(true);
  });

  it("compares two matching trials: fail -> pass shows improved", () => {
    const baseProv = {
      caseFingerprint: "cfp",
      graderFingerprint: "gfp",
      comparisonFingerprint: "cmp-123",
      actorModel: "model-x",
      judgeModel: "judge-y",
      hostVersion: "1.0",
      actorTimeoutMs: 180_000,
      judgeTimeoutMs: 60_000,
      subjectRevision: "rev-1",
    };

    const trial1: EvalReport = {
      schemaVersion: "tc-eval/v1",
      caseId: "delivery",
      title: "Delivery",
      verdict: "fail",
      summary: "code functional failure",
      startedAt: "2026-09-09T10:00:00.000Z",
      finishedAt: "2026-09-09T10:00:10.000Z",
      workspace: "/tmp",
      requirements: "req",
      setupError: null,
      executionError: null,
      gradingError: null,
      graderError: null,
      actor: [
        {
          phase: "actor",
          status: "success",
          elapsedMs: 8000,
          callCount: 1,
          diagnostics: [],
          hostVersion: "1.0",
          model: "model-x",
          resultMetadata: null,
        },
      ],
      checks: [
        {
          id: "c1",
          grader: "code",
          verdict: "fail",
          reason: "output missing",
          evidence: [],
        },
      ],
      model: {
        status: "pass",
        elapsedMs: 1000,
        callCount: 1,
        diagnostics: [],
      },
      task: null,
      taskReadError: null,
      environment: {
        node: "24",
        host: "h",
        model: "model-x",
        judgeModel: "judge-y",
      },
      provenance: baseProv,
    };

    const trial2: EvalReport = {
      ...trial1,
      verdict: "pass",
      summary: "all checks passed",
      startedAt: "2026-09-09T10:05:00.000Z",
      finishedAt: "2026-09-09T10:05:08.000Z", // 2 seconds faster
      checks: [
        {
          id: "c1",
          grader: "code",
          verdict: "pass",
          reason: "output verified",
          evidence: [],
        },
      ],
      provenance: {
        ...baseProv,
        subjectRevision: "rev-2", // different git revision
      },
    };

    const comp = computeReportComparison(trial2, trial1);
    expect(comp.status).toBe("improved");
    expect(comp.displayText).toBe("改善");
    expect(comp.timingDeltaMs).toBe(-2000); // 8s vs 10s -> -2s
    expect(comp.displayTimingDelta).toBe("-2.0秒");
    expect(comp.checkDeltas[0]?.status).toBe("improved");
  });

  it("compares pass -> fail as regressed and pass -> pass as unchanged", () => {
    const baseProv = {
      caseFingerprint: "cfp",
      graderFingerprint: "gfp",
      comparisonFingerprint: "cmp-123",
      actorModel: "model-x",
      judgeModel: "judge-y",
      hostVersion: "1.0",
      actorTimeoutMs: 180_000,
      judgeTimeoutMs: 60_000,
      subjectRevision: "rev-1",
    };

    const passTrial: EvalReport = {
      schemaVersion: "tc-eval/v1",
      caseId: "delivery",
      title: "Delivery",
      verdict: "pass",
      summary: "passed",
      startedAt: "2026-09-09T10:00:00.000Z",
      finishedAt: "2026-09-09T10:00:05.000Z",
      workspace: "/tmp",
      requirements: "req",
      setupError: null,
      executionError: null,
      gradingError: null,
      graderError: null,
      actor: [
        {
          phase: "actor",
          status: "success",
          elapsedMs: 4000,
          callCount: 1,
          diagnostics: [],
          hostVersion: "1.0",
          model: "model-x",
          resultMetadata: null,
        },
      ],
      checks: [
        {
          id: "c1",
          grader: "code",
          verdict: "pass",
          reason: "ok",
          evidence: [],
        },
      ],
      model: {
        status: "pass",
        elapsedMs: 500,
        callCount: 1,
        diagnostics: [],
      },
      task: null,
      taskReadError: null,
      environment: {
        node: "24",
        host: "h",
        model: "model-x",
        judgeModel: "judge-y",
      },
      provenance: baseProv,
    };

    const failTrial: EvalReport = {
      ...passTrial,
      verdict: "fail",
      summary: "failed",
      checks: [
        {
          id: "c1",
          grader: "code",
          verdict: "fail",
          reason: "bad",
          evidence: [],
        },
      ],
    };

    const regressedComp = computeReportComparison(failTrial, passTrial);
    expect(regressedComp.status).toBe("regressed");
    expect(regressedComp.displayText).toBe("退步");

    const unchangedComp = computeReportComparison(passTrial, passTrial);
    expect(unchangedComp.status).toBe("unchanged");
    expect(unchangedComp.displayText).toBe("持平");
  });

  it("never manufactures improvement or regression when either trial is inconclusive or blocked", () => {
    const baseProv = {
      caseFingerprint: "cfp",
      graderFingerprint: "gfp",
      comparisonFingerprint: "cmp-123",
      actorModel: "model-x",
      judgeModel: "judge-y",
      hostVersion: "1.0",
      actorTimeoutMs: 180_000,
      judgeTimeoutMs: 60_000,
      subjectRevision: "rev-1",
    };

    const blockedTrial: EvalReport = {
      schemaVersion: "tc-eval/v1",
      caseId: "delivery",
      title: "Delivery",
      verdict: "inconclusive",
      summary: "actor error",
      startedAt: "2026-09-09T10:00:00.000Z",
      finishedAt: "2026-09-09T10:00:05.000Z",
      workspace: "/tmp",
      requirements: "req",
      setupError: null,
      executionError: null,
      gradingError: null,
      graderError: null,
      actor: [
        {
          phase: "actor",
          status: "error",
          elapsedMs: 4000,
          callCount: 1,
          diagnostics: [],
          hostVersion: "1.0",
          model: "model-x",
          resultMetadata: null,
        },
      ],
      checks: [],
      model: {
        status: "inconclusive",
        elapsedMs: 500,
        callCount: 1,
        diagnostics: [],
      },
      task: null,
      taskReadError: null,
      environment: {
        node: "24",
        host: "h",
        model: "model-x",
        judgeModel: "judge-y",
      },
      provenance: baseProv,
    };

    const passTrial: EvalReport = {
      ...blockedTrial,
      verdict: "pass",
      actor: [
        {
          phase: "actor",
          status: "success",
          elapsedMs: 4000,
          callCount: 1,
          diagnostics: [],
          hostVersion: "1.0",
          model: "model-x",
          resultMetadata: null,
        },
      ],
    };

    const comp1 = computeReportComparison(passTrial, blockedTrial);
    expect(comp1.status).toBe("unchanged");
    expect(comp1.displayText).toBe("前置受阻，无有效判定比对");

    const comp2 = computeReportComparison(blockedTrial, passTrial);
    expect(comp2.status).toBe("unchanged");
    expect(comp2.displayText).toBe("前置受阻，无有效判定比对");
  });

  it("handles malformed JSON files gracefully without throwing", () => {
    writeFileSync(join(tempDir, "corrupted.json"), "NOT JSON DATA", "utf8");
    writeFileSync(
      join(tempDir, "missing-fields.json"),
      JSON.stringify({ someField: 123 }),
      "utf8",
    );

    const data = loadBoardData(tempDir);
    expect(data.malformedDiagnostics?.length).toBe(2);
    expect(data.malformedDiagnostics?.[0]?.filename).toBe("corrupted.json");
    expect(data.malformedDiagnostics?.[1]?.filename).toBe(
      "missing-fields.json",
    );
    expect(data.overview.totalScenarios).toBe(3);
    expect(data.overview.unrunScenarios).toBe(3);
  });

  it("reports JSON-valid reports with missing or mistyped fields instead of crashing the whole board", () => {
    // Valid schemaVersion/caseId but no checks/actor/environment arrays.
    writeFileSync(
      join(tempDir, "missing-arrays.json"),
      JSON.stringify({
        schemaVersion: "tc-eval/v1",
        caseId: "delivery",
        verdict: "fail",
        startedAt: "2026-09-09T10:00:00.000Z",
        finishedAt: "2026-09-09T10:00:01.000Z",
      }),
      "utf8",
    );
    // checks exists but contains a non-object entry.
    writeFileSync(
      join(tempDir, "bad-check-entry.json"),
      JSON.stringify({
        schemaVersion: "tc-eval/v1",
        caseId: "delivery",
        verdict: "pass",
        startedAt: "2026-09-09T10:00:00.000Z",
        finishedAt: "2026-09-09T10:00:01.000Z",
        actor: [],
        checks: ["not-an-object"],
        environment: { node: "24", host: "h" },
      }),
      "utf8",
    );

    expect(() => loadBoardData(tempDir)).not.toThrow();
    const data = loadBoardData(tempDir);
    expect(data.malformedDiagnostics?.length).toBe(2);
    expect(data.reports).toHaveLength(0);
    expect(data.overview.unrunScenarios).toBe(3);
  });
});
