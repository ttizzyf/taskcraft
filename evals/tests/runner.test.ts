import { describe, expect, it } from "vitest";

import type { CheckResult, HostRun } from "../core/types.ts";
import { aggregate, observedActorModel } from "../core/runner.ts";
import { CASES, findCase } from "../cases/index.ts";

function host(status: HostRun["status"], phase = "actor"): HostRun {
  return {
    phase,
    status,
    exitCode: status === "success" ? 0 : 1,
    signal: null,
    elapsedMs: 10,
    callCount: 1,
    resultText: null,
    diagnostics: [],
  };
}

function code(id: string, verdict: CheckResult["verdict"]): CheckResult {
  return { id, grader: "code", verdict, reason: "r", evidence: ["e"] };
}

function modelCheck(id: string, verdict: CheckResult["verdict"]): CheckResult {
  return { id, grader: "model", verdict, reason: "r", evidence: ["e"] };
}

describe("observed actor model", () => {
  it("records a shared observed model and rejects missing or mixed phase identities", () => {
    expect(
      observedActorModel([
        { model: "actual-model" },
        { model: "actual-model" },
      ]),
    ).toBe("actual-model");
    expect(observedActorModel([])).toBeNull();
    expect(observedActorModel([{ model: "actual-model" }, {}])).toBeNull();
    expect(
      observedActorModel([{ model: "first-model" }, { model: "second-model" }]),
    ).toBeNull();
  });
});

describe("verdict aggregation", () => {
  it("passes only when every necessary check passes", () => {
    const result = aggregate(
      [host("success")],
      [
        code("csv-functional", "pass"),
        code("tc-done", "pass"),
        modelCheck("model-requirements", "pass"),
        modelCheck("model-overall", "pass"),
      ],
    );
    expect(result.verdict).toBe("pass");
  });

  it("keeps a hard code failure even when the model passes", () => {
    const result = aggregate(
      [host("success")],
      [
        code("csv-functional", "fail"),
        modelCheck("model-requirements", "pass"),
        modelCheck("model-overall", "pass"),
      ],
    );
    expect(result.verdict).toBe("fail");
    expect(result.summary).toContain("cannot override");
  });

  it("keeps a hard code failure even when the model grader errors", () => {
    const result = aggregate(
      [host("success")],
      [code("csv-functional", "fail")],
    );
    expect(result.verdict).toBe("fail");
  });

  it("is inconclusive when no independent code check was recorded", () => {
    const result = aggregate(
      [host("success")],
      [modelCheck("model-overall", "pass")],
    );
    expect(result.verdict).toBe("inconclusive");
    expect(result.summary).toContain("necessary code check");
  });

  it("flags a model-reported failure that code checks did not catch", () => {
    const result = aggregate(
      [host("success")],
      [
        code("csv-functional", "pass"),
        modelCheck("model-honesty", "fail"),
        modelCheck("model-overall", "fail"),
      ],
    );
    expect(result.verdict).toBe("fail");
  });

  it("is inconclusive when a necessary check could not be verified", () => {
    const result = aggregate(
      [host("success")],
      [
        code("csv-functional", "pass"),
        code("tc-record", "inconclusive"),
        modelCheck("model-overall", "pass"),
      ],
    );
    expect(result.verdict).toBe("inconclusive");
  });

  it("does not record an unexecuted workspace as a genuine failure", () => {
    const result = aggregate([host("error")], [code("csv-functional", "fail")]);
    expect(result.verdict).toBe("inconclusive");
    expect(result.summary).toContain("not established");
  });

  it("reports not-run model explicitly", () => {
    const result = aggregate(
      [host("success")],
      [code("csv-functional", "pass")],
    );
    expect(result.verdict).toBe("inconclusive");
    expect(result.summary).toContain("not-run");
  });
});

describe("case registry", () => {
  it("exposes the five approved cases", () => {
    expect(CASES.map((candidate) => candidate.id).sort()).toEqual([
      "delivery",
      "l2-review",
      "recovery",
      "review",
      "session-resume",
    ]);
  });

  it("finds a case by id and rejects unknown ids", () => {
    expect(findCase("delivery")?.title).toContain("delivery");
    expect(findCase("unknown")).toBeUndefined();
  });
});
