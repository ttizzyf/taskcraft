import { describe, expect, it } from "vitest";

import type { EvalContext, HostRun, HostRunRequest } from "../core/types.ts";
import { parseModelOutput, runModelGrader } from "../graders/model.ts";
import type { CheckResult, ModelCriteria } from "../core/types.ts";
import {
  MODEL_PROMPT_SAMPLES,
  type ModelPromptSample,
} from "./fixtures/model-grader-samples.ts";

const CRITERIA: ModelCriteria[] = [
  { id: "requirements", question: "requirements met?" },
  { id: "scope", question: "scope respected?" },
];

function fakeContext(result: HostRun): EvalContext {
  return {
    repoRoot: process.cwd(),
    cliPath: "dist/cli.js",
    runTc: async () => ({
      status: 0,
      stdout: "",
      stderr: "",
      elapsedMs: 0,
    }),
    readTask: async () => ({ snapshot: null, error: null }),
    hashSources: async () => [],
    host: {
      run: async () => result,
    },
  };
}

function hostSuccess(resultText: string): HostRun {
  return {
    phase: "model-grader",
    status: "success",
    exitCode: 0,
    signal: null,
    elapsedMs: 10,
    callCount: 1,
    resultText,
    diagnostics: [],
  };
}

async function capturePrompt(
  sample: ModelPromptSample,
  codeChecks: CheckResult[] = [],
): Promise<{ prompt: string; request: HostRunRequest }> {
  let request: HostRunRequest | undefined;
  const context = fakeContext(hostSuccess(JSON.stringify(VALID_OUTPUT)));
  context.host.run = async (candidate) => {
    request = candidate;
    return hostSuccess(JSON.stringify(VALID_OUTPUT));
  };
  await runModelGrader({
    context,
    workspace: process.cwd(),
    criteria: CRITERIA,
    codeChecks,
    ...sample,
    timeoutMs: 1_000,
  });
  if (request === undefined) throw new Error("model grader request was absent");
  return { prompt: request.prompt, request };
}

const VALID_OUTPUT = {
  verdict: "pass",
  reason: "evidence supports the claim",
  checks: [
    {
      id: "requirements",
      verdict: "pass",
      reason: "quoted CSV is implemented",
      evidence: ["src/csv-summary.mjs"],
    },
    {
      id: "scope",
      verdict: "pass",
      reason: "changes stay in src",
      evidence: ["git status shows only src"],
    },
  ],
};

const SAMPLE_ENTRIES = Object.entries(MODEL_PROMPT_SAMPLES) as Array<
  [string, ModelPromptSample]
>;

describe("parseModelOutput", () => {
  it("accepts a complete structured judgment", () => {
    const parsed = parseModelOutput(JSON.stringify(VALID_OUTPUT), CRITERIA);
    expect(parsed).not.toBeNull();
    expect(parsed?.length).toBe(3);
    expect(parsed?.map((check) => check.id)).toEqual([
      "model-requirements",
      "model-scope",
      "model-overall",
    ]);
  });

  it("rejects a blank top-level reason", () => {
    const output = { ...VALID_OUTPUT, reason: "   " };
    expect(parseModelOutput(JSON.stringify(output), CRITERIA)).toBeNull();
  });

  it("rejects a blank per-criterion reason", () => {
    const output = {
      ...VALID_OUTPUT,
      checks: [
        { ...VALID_OUTPUT.checks[0]!, reason: "" },
        VALID_OUTPUT.checks[1],
      ],
    };
    expect(parseModelOutput(JSON.stringify(output), CRITERIA)).toBeNull();
  });

  it("rejects empty evidence arrays", () => {
    const output = {
      ...VALID_OUTPUT,
      checks: [
        { ...VALID_OUTPUT.checks[0]!, evidence: [] },
        VALID_OUTPUT.checks[1],
      ],
    };
    expect(parseModelOutput(JSON.stringify(output), CRITERIA)).toBeNull();
  });

  it("rejects empty evidence strings", () => {
    const output = {
      ...VALID_OUTPUT,
      checks: [
        { ...VALID_OUTPUT.checks[0]!, evidence: [" "] },
        VALID_OUTPUT.checks[1],
      ],
    };
    expect(parseModelOutput(JSON.stringify(output), CRITERIA)).toBeNull();
  });

  it("rejects a missing criterion and an extra criterion", () => {
    const missing = {
      ...VALID_OUTPUT,
      checks: [VALID_OUTPUT.checks[0]],
    };
    expect(parseModelOutput(JSON.stringify(missing), CRITERIA)).toBeNull();
    const extra = {
      ...VALID_OUTPUT,
      checks: [
        ...VALID_OUTPUT.checks,
        {
          id: "requirements",
          verdict: "pass",
          reason: "duplicate",
          evidence: ["x"],
        },
      ],
    };
    expect(parseModelOutput(JSON.stringify(extra), CRITERIA)).toBeNull();
  });

  it("rejects unknown verdicts and duplicate ids", () => {
    const badVerdict = {
      ...VALID_OUTPUT,
      checks: [
        { ...VALID_OUTPUT.checks[0]!, verdict: "maybe" },
        VALID_OUTPUT.checks[1],
      ],
    };
    expect(parseModelOutput(JSON.stringify(badVerdict), CRITERIA)).toBeNull();
    const duplicate = {
      ...VALID_OUTPUT,
      checks: [
        { ...VALID_OUTPUT.checks[0]!, id: "scope" },
        VALID_OUTPUT.checks[1],
      ],
    };
    expect(parseModelOutput(JSON.stringify(duplicate), CRITERIA)).toBeNull();
  });

  it("rejects schema-unknown fields", () => {
    const output = {
      ...VALID_OUTPUT,
      extra: true,
      checks: VALID_OUTPUT.checks.map((check) => ({
        ...check,
        extra: true,
      })),
    };
    expect(parseModelOutput(JSON.stringify(output), CRITERIA)).toBeNull();
  });
});

describe("runModelGrader", () => {
  it("records the actual judge host model and version for provenance", async () => {
    const hostRun = {
      ...hostSuccess(JSON.stringify(VALID_OUTPUT)),
      model: "judge-model-observed",
      hostVersion: "1.2.3",
    };
    const grade = await runModelGrader({
      context: fakeContext(hostRun),
      workspace: process.cwd(),
      requirements: "req",
      criteria: CRITERIA,
      codeChecks: [],
      actorRuns: [],
      actorResult: null,
      artifacts: [],
      task: { snapshot: null, error: null },
      timeoutMs: 1_000,
    });
    expect(grade.model).toBe("judge-model-observed");
    expect(grade.hostVersion).toBe("1.2.3");
  });

  it("surfaces valid structured output as checks", async () => {
    const grade = await runModelGrader({
      context: fakeContext(hostSuccess(JSON.stringify(VALID_OUTPUT))),
      workspace: process.cwd(),
      requirements: "req",
      criteria: CRITERIA,
      codeChecks: [],
      actorRuns: [],
      actorResult: null,
      artifacts: [],
      task: { snapshot: null, error: null },
      timeoutMs: 1_000,
    });
    expect(grade.checks.some((check) => check.verdict === "pass")).toBe(true);
    expect(grade.checks.every((check) => check.grader === "model")).toBe(true);
  });

  it("returns inconclusive when the host run errors", async () => {
    const grade = await runModelGrader({
      context: fakeContext({
        ...hostSuccess(""),
        status: "error",
        exitCode: 1,
        diagnostics: ["service unavailable"],
      }),
      workspace: process.cwd(),
      requirements: "req",
      criteria: CRITERIA,
      codeChecks: [],
      actorRuns: [],
      actorResult: null,
      artifacts: [],
      task: { snapshot: null, error: null },
      timeoutMs: 1_000,
    });
    expect(grade.checks).toHaveLength(3);
    expect(
      grade.checks.every((check) => check.verdict === "inconclusive"),
    ).toBe(true);
  });

  it("returns inconclusive for structurally invalid JSON", async () => {
    const grade = await runModelGrader({
      context: fakeContext(hostSuccess('{"verdict":"pass"}')),
      workspace: process.cwd(),
      requirements: "req",
      criteria: CRITERIA,
      codeChecks: [],
      actorRuns: [],
      actorResult: null,
      artifacts: [],
      task: { snapshot: null, error: null },
      timeoutMs: 1_000,
    });
    expect(
      grade.checks.every((check) => check.verdict === "inconclusive"),
    ).toBe(true);
  });

  it("gives the judge the actor final text and artifact contents", async () => {
    let prompt = "";
    const context = fakeContext(hostSuccess(JSON.stringify(VALID_OUTPUT)));
    context.host.run = async (request) => {
      prompt = request.prompt;
      return hostSuccess(JSON.stringify(VALID_OUTPUT));
    };
    await runModelGrader({
      context,
      workspace: process.cwd(),
      requirements: "csv contract",
      criteria: CRITERIA,
      codeChecks: [],
      actorRuns: [
        {
          phase: "delivery-actor",
          status: "success",
          exitCode: 0,
          signal: null,
          elapsedMs: 1,
          callCount: 4,
          resultText: "final actor summary",
          diagnostics: [],
        },
      ],
      actorResult: "final actor summary",
      artifacts: [{ path: "src/csv-summary.mjs", content: "export {};" }],
      task: { snapshot: null, error: null },
      timeoutMs: 1_000,
    });
    expect(prompt).toContain("final actor summary");
    expect(prompt).toContain("src/csv-summary.mjs");
    expect(prompt).toContain("export {};");
  });

  it("keeps external code-check verdicts, reasons, evidence, and scores out of the prompt", async () => {
    const { prompt } = await capturePrompt(MODEL_PROMPT_SAMPLES.complete!, [
      {
        id: "csv-functional",
        grader: "code",
        verdict: "fail",
        reason: "SECRET_CODE_REASON",
        evidence: ["SECRET_CODE_EVIDENCE"],
      },
    ]);
    expect(prompt).not.toContain("SECRET_CODE_REASON");
    expect(prompt).not.toContain("SECRET_CODE_EVIDENCE");
    expect(prompt).not.toContain('"codeChecks"');
    expect(prompt).not.toContain("aggregate score: 0");
  });

  it.each(SAMPLE_ENTRIES)(
    "preserves %s sample evidence channels for independent review",
    async (_name, sample) => {
      if (sample === undefined)
        throw new Error("model prompt sample was absent");
      const { prompt, request } = await capturePrompt(sample);
      expect(prompt).toContain(sample.requirements);
      for (const artifact of sample.artifacts) {
        expect(prompt).toContain(artifact.path);
        expect(prompt).toContain(JSON.stringify(artifact.content));
      }
      for (const run of sample.actorRuns) {
        expect(prompt).toContain(run.phase);
        expect(prompt).toContain(`"status": "${run.status}"`);
        expect(prompt).toContain(`"exitCode": ${String(run.exitCode)}`);
        expect(prompt).toContain(`"callCount": ${String(run.callCount)}`);
        if (run.signal !== null) expect(prompt).toContain(run.signal);
        if (run.resultText !== null) expect(prompt).toContain(run.resultText);
      }
      if (sample.checkpoint !== undefined) {
        expect(prompt).toContain(sample.checkpoint.reason);
        expect(prompt).toContain(sample.checkpoint.attemptIds[0]!);
      }
      if (sample.task.snapshot !== null) {
        expect(prompt).toContain(sample.task.snapshot.taskId);
        expect(prompt).toContain("fact-");
      } else {
        expect(prompt).toContain(sample.task.error!);
      }
      expect(request.tools).toBe("");
      expect(request.allowedTools).toEqual([]);
      expect(request.jsonSchema).toContain('"additionalProperties":false');
      expect(request.jsonSchema).toContain('"verdict"');
    },
  );
});
