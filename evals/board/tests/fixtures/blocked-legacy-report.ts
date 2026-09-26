import type { EvalReport } from "../../../core/types.ts";

/** A delivery run whose actor never completed, shaped like the 2026-09-09
 * legacy report the board was first validated against: one actor session that
 * errored with an `unrecognized_model` warning, checks that must therefore be
 * rendered as derived-inconclusive rather than independent failures.
 *
 * The real report is a git-ignored run artifact and only exists on the machine
 * that produced it, so tests fall back to this fixture on a fresh checkout. */
export function blockedLegacyReport(): EvalReport {
  return {
    schemaVersion: "tc-eval/v1",
    caseId: "delivery",
    title: "CSV feature delivery",
    verdict: "inconclusive",
    summary: "actor error; judge error",
    startedAt: "2026-09-09T11:29:30.582Z",
    finishedAt: "2026-09-09T11:31:30.582Z",
    workspace: "/tmp/taskcraft-eval-delivery",
    requirements: "Implement and record the CSV summary contract.",
    setupError: null,
    executionError: "actor error",
    gradingError: null,
    graderError: "judge error",
    actor: [
      {
        phase: "delivery-actor",
        status: "error",
        elapsedMs: 47_683,
        callCount: 1,
        diagnostics: [
          "Warning: unrecognized_model gemini-3.8-flash-high[1M] (not diagnosed as root cause)",
        ],
        hostVersion: "2.1.177",
        model: "gemini-3.8-flash-high[1M]",
        resultMetadata: null,
      },
    ],
    checks: [
      {
        id: "csv-functional",
        grader: "code",
        verdict: "fail",
        reason: "src/csv-summary.mjs is missing",
        evidence: [],
      },
      {
        id: "tc-done",
        grader: "code",
        verdict: "fail",
        reason: "task still queued",
        evidence: [],
      },
      {
        id: "requirements",
        grader: "model",
        verdict: "inconclusive",
        reason: "judge unavailable",
        evidence: [],
      },
    ],
    model: {
      status: "inconclusive",
      elapsedMs: 1_725,
      callCount: null,
      diagnostics: ["judge error"],
    },
    task: null,
    taskReadError: null,
    environment: {
      node: "v24.8.0",
      host: "claude",
      model: "gemini-3.8-flash-high[1M]",
      judgeModel: null,
    },
  };
}
