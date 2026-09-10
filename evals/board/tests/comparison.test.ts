import { describe, expect, it } from "vitest";

import {
  computeCheckComparison,
  computeReportComparison,
  formatBoardData,
  isExecutionEstablished,
} from "../data.ts";
import type { CheckResult, EvalReport } from "../../core/types.ts";

describe("evals board per-check deltas and execution establishment", () => {
  it("aligns per-check deltas by id and surfaces added and removed checks", () => {
    const before: CheckResult[] = [
      { id: "a", grader: "code", verdict: "fail", reason: "r", evidence: [] },
      { id: "b", grader: "code", verdict: "pass", reason: "r", evidence: [] },
      {
        id: "dropped",
        grader: "model",
        verdict: "pass",
        reason: "r",
        evidence: [],
      },
    ];
    const after: CheckResult[] = [
      { id: "a", grader: "code", verdict: "pass", reason: "r", evidence: [] },
      { id: "b", grader: "code", verdict: "fail", reason: "r", evidence: [] },
      {
        id: "added",
        grader: "model",
        verdict: "inconclusive",
        reason: "r",
        evidence: [],
      },
    ];

    const deltas = computeCheckComparison(after, before);
    expect(deltas.map((d) => [d.id, d.status])).toEqual([
      ["a", "improved"],
      ["b", "regressed"],
      ["added", "new"],
      ["dropped", "missing"],
    ]);
    expect(deltas[3]?.currentVerdict).toBeNull();
  });

  it("does not treat pass <-> inconclusive flips as improvement or regression", () => {
    const before: CheckResult[] = [
      {
        id: "c",
        grader: "model",
        verdict: "inconclusive",
        reason: "r",
        evidence: [],
      },
    ];
    const after: CheckResult[] = [
      { id: "c", grader: "model", verdict: "pass", reason: "r", evidence: [] },
    ];
    const deltas = computeCheckComparison(after, before);
    expect(deltas[0]?.status).toBe("unchanged");
    expect(deltas[0]?.displayText).toBe("inconclusive → pass");
  });

  it("keeps execution established when a successful actor run has a hard failure and a grader error", () => {
    const base = mkReport();
    const established = mkReport({
      verdict: "fail",
      graderError: "model grader crashed",
      checks: [codeCheck("csv-functional", "fail")],
    });

    expect(isExecutionEstablished(established)).toBe(true);
    const comp = computeReportComparison(
      established,
      mkReport({ checks: [codeCheck("csv-functional", "pass")] }),
    );
    expect(comp.status).toBe("regressed");
    expect(comp.displayText).not.toContain("受阻");
    expect(comp.timingDeltaMs).toBe(
      new Date(established.finishedAt).getTime() -
        new Date(established.startedAt).getTime() -
        (new Date(base.finishedAt).getTime() -
          new Date(base.startedAt).getTime()),
    );
  });

  it("classifies an established run with an inconclusive check as 无法判定, not blocked", () => {
    const establishedInconclusive = mkReport({
      verdict: "inconclusive",
      checks: [codeCheck("csv-functional", "inconclusive")],
    });
    const data = formatBoardData([establishedInconclusive]);
    const row = data.scenarios.find((s) => s.id === "delivery");
    expect(row?.status).toBe("inconclusive");
    expect(row?.displayStatus).toBe("无法判定");
    expect(data.overview.inconclusiveScenarios).toBe(1);
    expect(data.overview.blockedScenarios).toBe(0);
    expect(data.overview.decisiveScenarios).toBe(0);
    expect(data.overview.unrunScenarios).toBe(2);
  });

  it("does not treat an actor error as established execution", () => {
    const failed = mkReport({
      verdict: "inconclusive",
      actor: [{ ...mkReport().actor[0]!, status: "error" }],
    });
    expect(isExecutionEstablished(failed)).toBe(false);
  });
});

function codeCheck(id: string, verdict: CheckResult["verdict"]): CheckResult {
  return { id, grader: "code", verdict, reason: "r", evidence: [] };
}

function mkReport(patch: Partial<EvalReport> = {}): EvalReport {
  return {
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
    checks: [codeCheck("csv-functional", "pass")],
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
    provenance: {
      caseFingerprint: "cfp",
      graderFingerprint: "gfp",
      comparisonFingerprint: "cmp-123",
      actorModel: "model-x",
      judgeModel: "judge-y",
      hostVersion: "1.0",
      actorTimeoutMs: 180_000,
      judgeTimeoutMs: 60_000,
      subjectRevision: "rev-1",
    },
    ...patch,
  };
}
