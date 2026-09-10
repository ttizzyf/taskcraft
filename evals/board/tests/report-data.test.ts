import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadBoardData } from "../data.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("evals board legacy report loading", () => {
  it("detects unrecognized_model diagnostic warning without diagnosing root cause", () => {
    const runDir = join(tmpdir(), `evals-board-legacy-test-${Date.now()}`);
    directories.push(runDir);
    mkdirSync(runDir, { recursive: true });
    copyFileSync(
      join(
        process.cwd(),
        "evals",
        "runs",
        "delivery-2026-09-09T11-29-30-582Z.json",
      ),
      join(runDir, "delivery.json"),
    );
    const data = loadBoardData(runDir);
    const delivery = data.scenarios.find(
      (scenario) => scenario.id === "delivery",
    );
    const actorSessions = delivery?.latestRun?.actorSessions ?? [];
    expect(actorSessions).toHaveLength(1);
    expect(actorSessions[0]?.hasUnrecognizedModelWarning).toBe(true);
  });

  it("handles malformed JSON files and malformed reports without throwing", () => {
    const runDir = join(tmpdir(), `evals-board-malformed-test-${Date.now()}`);
    directories.push(runDir);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "corrupted.json"), "NOT JSON DATA", "utf8");
    writeFileSync(
      join(runDir, "missing-fields.json"),
      JSON.stringify({ someField: 123 }),
      "utf8",
    );
    writeFileSync(
      join(runDir, "missing-arrays.json"),
      JSON.stringify({
        schemaVersion: "tc-eval/v1",
        caseId: "delivery",
        verdict: "fail",
        startedAt: "2026-09-09T10:00:00.000Z",
        finishedAt: "2026-09-09T10:00:01.000Z",
      }),
      "utf8",
    );
    writeFileSync(
      join(runDir, "bad-check-entry.json"),
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
    const validReport = {
      schemaVersion: "tc-eval/v1",
      caseId: "delivery",
      title: "Fixture",
      verdict: "pass",
      summary: "fixture",
      startedAt: "2026-09-09T10:00:00.000Z",
      finishedAt: "2026-09-09T10:00:01.000Z",
      workspace: runDir,
      requirements: "fixture",
      setupError: null,
      executionError: null,
      gradingError: null,
      graderError: null,
      actor: [
        {
          phase: "fixture",
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
          id: "fixture",
          grader: "code",
          verdict: "pass",
          reason: "fixture",
          evidence: [],
        },
        {
          id: "fixture-model",
          grader: "model",
          verdict: "pass",
          reason: "fixture",
          evidence: [],
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
        host: "fixture",
        model: null,
        judgeModel: null,
      },
    };
    writeFileSync(
      join(runDir, "unknown-verdict.json"),
      JSON.stringify({ ...validReport, verdict: "unknown" }),
      "utf8",
    );
    writeFileSync(
      join(runDir, "bad-diagnostics.json"),
      JSON.stringify({
        ...validReport,
        actor: [{ ...validReport.actor[0], diagnostics: [1] }],
      }),
      "utf8",
    );
    writeFileSync(
      join(runDir, "unknown-check-verdict.json"),
      JSON.stringify({
        ...validReport,
        checks: [{ ...validReport.checks[0], verdict: "unknown" }],
      }),
      "utf8",
    );
    const codePass = validReport.checks[0]!;
    const modelPass = validReport.checks[1]!;
    for (const [filename, checks] of [
      ["pass-code-fail.json", [{ ...codePass, verdict: "fail" }, modelPass]],
      [
        "pass-code-inconclusive.json",
        [{ ...codePass, verdict: "inconclusive" }, modelPass],
      ],
      ["pass-without-model.json", [codePass]],
      [
        "pass-model-inconclusive.json",
        [codePass, { ...modelPass, verdict: "inconclusive" }],
      ],
    ] as const) {
      writeFileSync(
        join(runDir, filename),
        JSON.stringify({ ...validReport, checks }),
        "utf8",
      );
    }

    const data = loadBoardData(runDir);
    expect(data.malformedDiagnostics).toHaveLength(11);
    expect(data.reports).toHaveLength(0);
    expect(data.overview.totalScenarios).toBe(5);
    expect(data.overview.decisiveScenarios).toBe(0);
  });
});
