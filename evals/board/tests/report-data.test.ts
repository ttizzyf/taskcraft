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

    const data = loadBoardData(runDir);
    expect(data.malformedDiagnostics).toHaveLength(4);
    expect(data.reports).toHaveLength(0);
    expect(data.overview.totalScenarios).toBe(5);
  });
});
