import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import { CASES } from "../cases/index.ts";
import {
  buildProvenance,
  checkComparisonCompatibility,
  computeCaseFingerprint,
  computeComparisonFingerprint,
  computeGraderFingerprint,
} from "../reporting/provenance.ts";
import type { EvalReport } from "../core/types.ts";

describe("provenance helper", () => {
  const deliveryCase = CASES.find((c) => c.id === "delivery")!;

  it("computes deterministic fingerprints for cases", () => {
    const fp1 = computeCaseFingerprint(deliveryCase);
    const fp2 = computeCaseFingerprint(deliveryCase);
    expect(fp1).toBe(fp2);
    expect(typeof fp1).toBe("string");
    expect(fp1.length).toBe(16);
  });

  it("invalidates comparison when implementation changes with unchanged requirements and vectors", () => {
    const caseBefore = computeCaseFingerprint(deliveryCase);
    vi.mocked(readFileSync).mockReturnValueOnce("changed case implementation");
    expect(computeCaseFingerprint(deliveryCase)).not.toBe(caseBefore);

    const graderBefore = computeGraderFingerprint(deliveryCase);
    vi.mocked(readFileSync).mockReturnValueOnce(
      "changed grader implementation",
    );
    expect(computeGraderFingerprint(deliveryCase)).not.toBe(graderBefore);
  });

  it("invalidates grader and comparison fingerprints when the verdict helper changes", () => {
    const readFile = vi.mocked(readFileSync);
    const defaultReadFile = readFile.getMockImplementation();
    expect(defaultReadFile).toBeDefined();

    let helperSource = "original verdict helper";
    readFile.withImplementation(
      (path) => {
        if (String(path).endsWith("/evals/reporting/report.ts")) {
          return helperSource;
        }
        return defaultReadFile!(path, "utf8") as string;
      },
      () => {
        const before = buildProvenance({
          caseDefinition: deliveryCase,
          actorModel: "actor-model",
          judgeModel: "judge-model",
          hostVersion: "1.0.0",
          actorTimeoutMs: 180_000,
          judgeTimeoutMs: 60_000,
          subjectRevision: "subject-revision",
        });

        helperSource = "changed verdict helper";
        const after = buildProvenance({
          caseDefinition: deliveryCase,
          actorModel: "actor-model",
          judgeModel: "judge-model",
          hostVersion: "1.0.0",
          actorTimeoutMs: 180_000,
          judgeTimeoutMs: 60_000,
          subjectRevision: "subject-revision",
        });

        expect(after.caseFingerprint).toBe(before.caseFingerprint);
        expect(after.graderFingerprint).not.toBe(before.graderFingerprint);
        expect(after.comparisonFingerprint).not.toBe(
          before.comparisonFingerprint,
        );
        expect(after.subjectRevision).toBe(before.subjectRevision);
      },
    );
  });

  it("computes deterministic grader fingerprints and reflects rubric / criteria changes", () => {
    const gfp1 = computeGraderFingerprint(deliveryCase);
    const gfp2 = computeGraderFingerprint(deliveryCase);
    expect(gfp1).toBe(gfp2);

    const modifiedCriteriaCase = {
      ...deliveryCase,
      modelCriteria: [
        {
          id: "requirements",
          question: "A completely different question?",
        },
      ],
    };
    const gfpModified = computeGraderFingerprint(modifiedCriteriaCase);
    expect(gfp1).not.toBe(gfpModified);
  });

  it("reflects case requirement changes in caseFingerprint", () => {
    const cfp1 = computeCaseFingerprint(deliveryCase);
    const modifiedCase = {
      ...deliveryCase,
      requirements: "Altered requirements text",
    };
    const cfpModified = computeCaseFingerprint(modifiedCase);
    expect(cfp1).not.toBe(cfpModified);
  });

  it("factors hostVersion into comparison fingerprint", () => {
    const base = {
      caseFingerprint: "case-fp",
      graderFingerprint: "grader-fp",
      actorModel: "model-a",
      judgeModel: "model-j",
      actorTimeoutMs: 180_000,
      judgeTimeoutMs: 60_000,
      hostVersion: "1.0.0",
    };

    const fp1 = computeComparisonFingerprint(base);
    const fpDiffHost = computeComparisonFingerprint({
      ...base,
      hostVersion: "2.0.0",
    });

    expect(fp1).not.toBe(fpDiffHost);
  });

  it("builds provenance with subject revision separate from comparison key", () => {
    const prov1 = buildProvenance({
      caseDefinition: deliveryCase,
      actorModel: "claude-sonnet-4-6",
      judgeModel: "claude-sonnet-4-6",
      hostVersion: "1.0.0",
      actorTimeoutMs: 180_000,
      judgeTimeoutMs: 60_000,
      subjectRevision: "rev-111",
    });

    const prov2 = buildProvenance({
      caseDefinition: deliveryCase,
      actorModel: "claude-sonnet-4-6",
      judgeModel: "claude-sonnet-4-6",
      hostVersion: "1.0.0",
      actorTimeoutMs: 180_000,
      judgeTimeoutMs: 60_000,
      subjectRevision: "rev-222", // different revision of tc!
    });

    // Subject revision differs, but comparisonFingerprint must match!
    expect(prov1.subjectRevision).toBe("rev-111");
    expect(prov2.subjectRevision).toBe("rev-222");
    expect(prov1.comparisonFingerprint).toBe(prov2.comparisonFingerprint);
  });

  it("changes comparison fingerprint when budget or model changes", () => {
    const base = {
      caseFingerprint: "case-fp",
      graderFingerprint: "grader-fp",
      actorModel: "model-a",
      judgeModel: "model-j",
      actorTimeoutMs: 180_000,
      judgeTimeoutMs: 60_000,
    };

    const fp1 = computeComparisonFingerprint(base);
    const fpModelDiff = computeComparisonFingerprint({
      ...base,
      actorModel: "model-b",
    });
    const fpBudgetDiff = computeComparisonFingerprint({
      ...base,
      actorTimeoutMs: 90_000,
    });

    expect(fp1).not.toBe(fpModelDiff);
    expect(fp1).not.toBe(fpBudgetDiff);
  });

  it("reports missing_metadata if either report lacks provenance or has null model", () => {
    const repWithProv: EvalReport = {
      schemaVersion: "tc-eval/v1",
      caseId: "delivery",
      title: "Delivery",
      verdict: "pass",
      summary: "ok",
      startedAt: "2026-09-09T10:00:00.000Z",
      finishedAt: "2026-09-09T10:01:00.000Z",
      workspace: "/tmp",
      requirements: "req",
      setupError: null,
      executionError: null,
      gradingError: null,
      graderError: null,
      actor: [],
      checks: [],
      model: {
        status: "pass",
        elapsedMs: 10,
        callCount: 1,
        diagnostics: [],
      },
      task: null,
      taskReadError: null,
      environment: {
        node: "24",
        host: "local",
        model: "m1",
        judgeModel: "m1",
      },
      provenance: {
        caseFingerprint: "c1",
        graderFingerprint: "g1",
        comparisonFingerprint: "cmp1",
        actorModel: "m1",
        judgeModel: "m1",
        hostVersion: "1.0",
        actorTimeoutMs: 180_000,
        judgeTimeoutMs: 60_000,
        subjectRevision: "r1",
      },
    };

    const repLegacy: EvalReport = {
      ...repWithProv,
      provenance: undefined,
    };

    const res = checkComparisonCompatibility(repWithProv, repLegacy);
    expect(res.comparable).toBe(false);
    expect(res.reason).toBe("missing_metadata");

    // Also if actorModel is null
    const repNullModel: EvalReport = {
      ...repWithProv,
      provenance: {
        ...repWithProv.provenance!,
        actorModel: null,
      },
    };
    const repNullModel2: EvalReport = {
      ...repWithProv,
      provenance: {
        ...repWithProv.provenance!,
        actorModel: null,
      },
    };
    // Two null models must NEVER match!
    const resNulls = checkComparisonCompatibility(repNullModel, repNullModel2);
    expect(resNulls.comparable).toBe(false);
    expect(resNulls.reason).toBe("missing_metadata");

    for (const provenance of [
      null,
      {},
      { ...repWithProv.provenance, actorModel: "" },
      { ...repWithProv.provenance, comparisonFingerprint: undefined },
    ]) {
      const malformed = { ...repWithProv, provenance } as EvalReport;
      expect(checkComparisonCompatibility(malformed, malformed)).toEqual({
        comparable: false,
        reason: "missing_metadata",
      });
    }
  });

  it("reports condition_mismatch when fingerprints differ or cases differ", () => {
    const repA: EvalReport = {
      schemaVersion: "tc-eval/v1",
      caseId: "delivery",
      title: "Delivery",
      verdict: "pass",
      summary: "ok",
      startedAt: "2026-09-09T10:00:00.000Z",
      finishedAt: "2026-09-09T10:01:00.000Z",
      workspace: "/tmp",
      requirements: "req",
      setupError: null,
      executionError: null,
      gradingError: null,
      graderError: null,
      actor: [],
      checks: [],
      model: {
        status: "pass",
        elapsedMs: 10,
        callCount: 1,
        diagnostics: [],
      },
      task: null,
      taskReadError: null,
      environment: {
        node: "24",
        host: "local",
        model: "m1",
        judgeModel: "m1",
      },
      provenance: {
        caseFingerprint: "c1",
        graderFingerprint: "g1",
        comparisonFingerprint: "cmp1",
        actorModel: "m1",
        judgeModel: "m1",
        hostVersion: "1.0",
        actorTimeoutMs: 180_000,
        judgeTimeoutMs: 60_000,
        subjectRevision: "r1",
      },
    };

    const repB: EvalReport = {
      ...repA,
      provenance: {
        ...repA.provenance!,
        comparisonFingerprint: "cmp2",
      },
    };

    const res = checkComparisonCompatibility(repA, repB);
    expect(res.comparable).toBe(false);
    expect(res.reason).toBe("condition_mismatch");

    const staleFingerprint: EvalReport = {
      ...repA,
      provenance: { ...repA.provenance!, actorModel: "different-model" },
    };
    expect(checkComparisonCompatibility(repA, staleFingerprint)).toEqual({
      comparable: false,
      reason: "condition_mismatch",
    });

    const repDiffCase: EvalReport = {
      ...repA,
      caseId: "recovery",
    };
    const resDiffCase = checkComparisonCompatibility(repA, repDiffCase);
    expect(resDiffCase.comparable).toBe(false);
    expect(resDiffCase.reason).toBe("condition_mismatch");
  });
});
