import { hostname } from "node:os";
import { join } from "node:path";

import { collectArtifacts } from "../graders/artifacts.ts";
import { runModelGrader } from "../graders/model.ts";
import { writeReport } from "../reporting/writer.ts";
import { runClaude } from "../hosts/claude.ts";
import { PI_EVAL_MODEL, runPi } from "../hosts/pi.ts";
import { runTcCommand, readTaskSnapshot } from "./tc.ts";
import { createWorkspace, sourceSnapshot } from "./workspace.ts";
import type {
  CheckResult,
  EvalCase,
  EvalContext,
  EvalReport,
  EvalOptions,
  HostRun,
  ModelGrade,
  TaskReadResult,
  Verdict,
} from "./types.ts";
import { findCase } from "../cases/index.ts";
import { buildProvenance } from "../reporting/provenance.ts";

export interface RunEvalOptions extends EvalOptions {
  cliPath?: string;
  runDir?: string;
}

export interface RunEvalResult {
  report: EvalReport;
  jsonPath: string;
  markdownPath: string;
}

const WORKSPACE_ROOT = "src";

/** Runs one eval case end-to-end in an out-of-repo temporary workspace and
 * writes JSON + Markdown reports under evals/runs. Independent code grading
 * always runs; the model grader runs as a supplemental semantic check that
 * can never override a concrete code failure. */
export async function runEval(options: RunEvalOptions): Promise<RunEvalResult> {
  const startedAt = new Date().toISOString();
  const workspace = createWorkspace(options.caseId ?? "eval");
  const cliPath = options.cliPath ?? join(process.cwd(), "dist", "cli.js");
  const runDir = options.runDir ?? join(process.cwd(), "evals", "runs");

  const caseDefinition = findCase(options.caseId ?? "");
  if (caseDefinition === undefined) {
    throw new Error(`unknown eval case: ${String(options.caseId)}`);
  }

  const hostAdapter = options.host ?? "claude";
  const context = buildContext(cliPath, hostAdapter);
  const actorTimeoutMs = options.actorTimeoutMs;
  const actorModel = requestedModel(hostAdapter, options.model);
  const judgeModel = requestedModel(hostAdapter, options.judgeModel);

  let setupError: string | null = null;
  let executionError: string | null = null;
  let gradingError: string | null = null;
  let graderError: string | null = null;
  let checks: CheckResult[] = [];
  let modelGrade: ModelGrade | null = null;
  let judgeEvidence: EvalReport["judgeEvidence"];
  let hostRuns: HostRun[] = [];
  let requirements = "";
  let task: TaskReadResult = { snapshot: null, error: null };
  let checkpoint = undefined;

  let setup: Awaited<ReturnType<EvalCase["prepare"]>> | undefined;
  try {
    setup = await caseDefinition.prepare(context, workspace);
    requirements = setup.requirement;
  } catch (error) {
    setupError = describe(error);
  }

  if (setup !== undefined) {
    let execution: Awaited<ReturnType<EvalCase["execute"]>> | undefined;
    try {
      execution = await caseDefinition.execute(
        context,
        setup,
        actorTimeoutMs,
        actorModel,
      );
      hostRuns = execution.hostRuns;
      checkpoint = execution.checkpoint;
      task = await context.readTask(workspace, setup.taskId);
    } catch (error) {
      executionError = describe(error);
    }

    if (execution !== undefined) {
      judgeEvidence = execution.judgeEvidence;
      let codeChecks: CheckResult[] | undefined;
      try {
        codeChecks = await caseDefinition.grade(
          context,
          setup,
          execution,
          task,
        );
        // Preserve independently obtained results even if the supplemental judge fails.
        checks = codeChecks;
      } catch (error) {
        gradingError = describe(error);
      }

      if (codeChecks !== undefined) {
        try {
          const modelChecks = await runModelGrader({
            context,
            workspace,
            requirements: setup.requirement,
            criteria:
              setup.modelCriteria.length > 0
                ? setup.modelCriteria
                : caseDefinition.modelCriteria,
            actorRuns: hostRuns,
            actorResult: lastResultText(hostRuns),
            artifacts: collectArtifacts(workspace),
            ...(checkpoint === undefined ? {} : { checkpoint }),
            task,
            ...(execution.judgeEvidence === undefined
              ? {}
              : { judgeEvidence: execution.judgeEvidence }),
            timeoutMs: options.judgeTimeoutMs,
            ...(judgeModel === undefined ? {} : { model: judgeModel }),
          });
          checks = [...codeChecks, ...modelChecks.checks];
          modelGrade = modelChecks;
        } catch (error) {
          graderError = describe(error);
        }
      }
    }
  }

  const { verdict, summary } = aggregate(hostRuns, checks);
  const finishedAt = new Date().toISOString();
  const report: EvalReport = {
    schemaVersion: "tc-eval/v1",
    caseId: caseDefinition.id,
    title: caseDefinition.title,
    verdict,
    summary,
    startedAt,
    finishedAt,
    workspace,
    requirements,
    setupError,
    executionError,
    gradingError,
    graderError,
    actor: hostRuns.map((run) => ({
      phase: run.phase,
      status: run.status,
      elapsedMs: run.elapsedMs,
      callCount: run.callCount,
      diagnostics: run.diagnostics,
      hostVersion: run.hostVersion ?? null,
      model: run.model ?? null,
      resultMetadata: run.resultMetadata ?? null,
      host: run.host ?? null,
      requestedModel: run.requestedModel ?? null,
      requestedThinkingLevel: run.requestedThinkingLevel ?? null,
      observedProvider: run.observedProvider ?? null,
      observedApi: run.observedApi ?? null,
      observedThinkingLevel: run.observedThinkingLevel ?? null,
    })),
    checks,
    model: modelStatus(modelGrade),
    ...(checkpoint === undefined ? {} : { checkpoint }),
    task: task.snapshot,
    taskReadError: task.error,
    ...(judgeEvidence === undefined ? {} : { judgeEvidence }),
    environment: {
      node: process.version,
      host: hostname(),
      model: actorModel ?? null,
      judgeModel: judgeModel ?? null,
      hostAdapter,
      actorThinkingLevel: sharedObserved(hostRuns, "observedThinkingLevel"),
      judgeThinkingLevel: modelGrade?.observedThinkingLevel ?? null,
    },
    provenance: buildProvenance({
      caseDefinition,
      // Requested aliases live in environment; comparison uses observations.
      actorModel: observedActorModel(hostRuns),
      judgeModel: modelGrade?.model ?? null,
      hostVersion:
        hostRuns.find(
          (r) => r.hostVersion !== null && r.hostVersion !== undefined,
        )?.hostVersion ??
        modelGrade?.hostVersion ??
        null,
      actorTimeoutMs: options.actorTimeoutMs,
      judgeTimeoutMs: options.judgeTimeoutMs,
      hostAdapter,
      actorApi: sharedObserved(hostRuns, "observedApi"),
      judgeApi: modelGrade?.observedApi ?? null,
      actorThinkingLevel: sharedObserved(hostRuns, "observedThinkingLevel"),
      judgeThinkingLevel: modelGrade?.observedThinkingLevel ?? null,
      repoRoot: context.repoRoot,
    }),
  };

  const paths = writeReport(report, runDir, caseDefinition.id);
  return { report, ...paths };
}

/** Returns a model only when every actor phase observed the same identity. */
export function observedActorModel(
  runs: Pick<HostRun, "model">[],
): string | null {
  const model = runs[0]?.model;
  return typeof model === "string" &&
    model.trim() !== "" &&
    runs.every((run) => run.model === model)
    ? model
    : null;
}

/** Aggregates independent code checks and the supplemental model judgment
 * into one explainable verdict.
 *
 * - A hard code failure is authoritative: it stays fail even when the model
 *   grader errors or disagrees (reliably obtained failure is never erased by
 *   later infrastructure problems).
 * - When no host run completed successfully, no execution is established, so
 *   an empty or partial workspace is recorded as inconclusive rather than as
 *   a genuine product failure.
 * - Every necessary check must pass before the result is pass.
 */
export function aggregate(
  hostRuns: HostRun[],
  checks: CheckResult[],
): { verdict: Verdict; summary: string } {
  const codeChecks = checks.filter((check) => check.grader === "code");
  const modelChecks = checks.filter((check) => check.grader === "model");
  const codeFail = codeChecks.some((check) => check.verdict === "fail");
  const codeInconclusive = codeChecks.some(
    (check) => check.verdict === "inconclusive",
  );
  const modelFail = modelChecks.some((check) => check.verdict === "fail");
  const modelInconclusive = modelChecks.some(
    (check) => check.verdict === "inconclusive",
  );
  const established = hostRuns.some((run) => run.status === "success");
  const phases = hostRuns.map((run) => `${run.phase}=${run.status}`).join(", ");
  const codeDetail = codeChecks
    .map((check) => `${check.id}:${check.verdict}`)
    .join(", ");
  const modelDetail = modelChecks
    .map((check) => `${check.id}:${check.verdict}`)
    .join(", ");

  if (!established) {
    return {
      verdict: "inconclusive",
      summary: `no actor session completed (${phases || "none"}); execution is not established, so a partial or empty workspace is not treated as a genuine task failure. code checks: ${codeDetail || "none"}. model: ${modelDetail || "not-run"}.`,
    };
  }
  if (codeChecks.length === 0) {
    return {
      verdict: "inconclusive",
      summary: `no necessary code check was recorded (${phases || "none"}); an independent code check is required before pass/fail. model: ${modelDetail || "not-run"}.`,
    };
  }
  if (codeFail) {
    return {
      verdict: "fail",
      summary: `independent code checks reported a hard failure (${codeDetail}); the model result cannot override it. model: ${modelDetail || "not-run"}.`,
    };
  }
  if (modelFail) {
    return {
      verdict: "fail",
      summary: `code checks passed but the semantic model grader reported a failure (${modelDetail}).`,
    };
  }
  if (codeInconclusive || modelInconclusive || modelChecks.length === 0) {
    return {
      verdict: "inconclusive",
      summary: `not every necessary check passed: code ${codeDetail || "none"}, model ${modelDetail || "not-run"} have inconclusive or absent entries.`,
    };
  }
  return {
    verdict: "pass",
    summary: `actor established execution and every code and model check passed (code ${codeDetail}).`,
  };
}

function modelStatus(model: ModelGrade | null): EvalReport["model"] {
  if (model === null) {
    return {
      status: "not-run",
      elapsedMs: null,
      callCount: null,
      diagnostics: ["model grader did not run"],
    };
  }
  const failed = model.checks.some((check) => check.verdict === "fail");
  const inconclusive = model.checks.some(
    (check) => check.verdict === "inconclusive",
  );
  return {
    status: failed ? "fail" : inconclusive ? "inconclusive" : "pass",
    elapsedMs: model.elapsedMs,
    callCount: model.callCount,
    diagnostics: model.diagnostics,
    host: model.host ?? null,
    requestedModel: model.requestedModel ?? null,
    requestedThinkingLevel: model.requestedThinkingLevel ?? null,
    observedProvider: model.observedProvider ?? null,
    observedApi: model.observedApi ?? null,
    observedThinkingLevel: model.observedThinkingLevel ?? null,
  };
}

function lastResultText(runs: HostRun[]): string | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run?.resultText !== null && run?.resultText !== undefined) {
      return run.resultText;
    }
  }
  return null;
}

function buildContext(
  cliPath: string,
  hostAdapter: NonNullable<EvalOptions["host"]>,
): EvalContext {
  const hostRun = hostAdapter === "pi-sdk" ? runPi : runClaude;
  return {
    repoRoot: process.cwd(),
    cliPath,
    runTc: (cwd, args, input) => runTcCommand(cliPath, cwd, args, input),
    readTask: (cwd, taskId) => readTaskSnapshot(cliPath, cwd, taskId),
    hashSources: (cwd) => Promise.resolve(sourceSnapshot(cwd)),
    host: {
      run: (request, phase) => hostRun(request, phase),
    },
  };
}

function requestedModel(
  hostAdapter: NonNullable<EvalOptions["host"]>,
  model: string | undefined,
): string | undefined {
  return hostAdapter === "pi-sdk" ? (model ?? PI_EVAL_MODEL) : model;
}

function sharedObserved(
  runs: HostRun[],
  field: "observedApi" | "observedThinkingLevel",
): string | null {
  const value = runs[0]?.[field];
  return typeof value === "string" &&
    value.trim() !== "" &&
    runs.every((run) => run[field] === value)
    ? value
    : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { EvalCase };
export { WORKSPACE_ROOT };
