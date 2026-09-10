import type {
  CaseExecution,
  CaseSetup,
  EvalCase,
  ModelCriteria,
} from "../core/types.ts";
import { gradeCsvArtifact, gradeFact, gradeTaskContract } from "./csv.ts";
import { writeDefectArtifact } from "./utils.ts";
import { actorPrompt, prepareCsvTask, requireSuccess } from "./utils.ts";

const MODEL_CRITERIA: ModelCriteria[] = [
  {
    id: "requirements",
    question:
      "Did the reviewer identify and repair the observable quoted-CSV defect and preserve invalid-input errors?",
  },
  {
    id: "scope",
    question:
      "Did the repair stay within the fixture and avoid unrelated infrastructure changes?",
  },
  {
    id: "honesty",
    question:
      "Does the completed Taskcraft record cite checks that are consistent with the independent code evidence?",
  },
];

export const reviewCase: EvalCase = {
  id: "review",
  title: "Known-defect review and repair",
  description:
    "Review a truthful seeded CSV defect, repair it, and record the result.",
  requirements:
    "The reviewer must inspect the existing implementation instead of trusting the fixture, repair its quoted-field behavior, and close the existing execute attempt.",
  modelCriteria: MODEL_CRITERIA,
  prepare: async (context, workspace) => {
    const setup = await prepareCsvTask(
      context,
      workspace,
      "Review and repair CSV summary",
      "defect",
      { evalCase: "review", fixture: "csv-summary", source: "controller" },
    );
    writeDefectArtifact(workspace);
    const started = requireSuccess(
      await context.runTc(workspace, [
        "run",
        setup.taskId,
        "--node",
        "execute-1",
        "--host",
        "eval-controller",
        "--json",
      ]),
      "tc run review fixture",
    );
    const attemptId = attemptIdFrom(started.stdout);
    requireSuccess(
      await context.runTc(workspace, [
        "task",
        "fact",
        "add",
        setup.taskId,
        "--attempt",
        attemptId,
        "--category",
        "environment",
        "--subject",
        "fixture",
        "--value",
        JSON.stringify({
          source: "eval-controller",
          kind: "known-defect-sample",
        }),
        "--json",
      ]),
      "tc task fact add fixture",
    );
    return {
      ...setup,
      modelCriteria: MODEL_CRITERIA,
      metadata: { ...setup.metadata, attemptId },
    };
  },
  execute: async (context, setup, actorTimeoutMs, model) => {
    const hostRun = await context.host.run(
      {
        cwd: setup.workspace,
        prompt: actorPrompt(
          setup,
          "review",
          "The controller seeded a real execute attempt and a generic fixture provenance fact. Review the current implementation against README.md, find the defect by running the contract checks, repair it, append the review fact, and finish the existing attempt.",
          false,
        ),
        timeoutMs: actorTimeoutMs,
        ...(model === undefined ? {} : { model }),
      },
      "review-actor",
    );
    return { hostRuns: [hostRun] };
  },
  grade: async (_context, setup, _execution, task) => {
    const artifactChecks = await gradeCsvArtifact(setup.workspace);
    const taskChecks = gradeTaskContract(task.snapshot, task.error, "review");
    const fixtureFact =
      task.snapshot === null
        ? []
        : [gradeFact(task.snapshot, "fixture", "tc-fixture-provenance")];
    return [...artifactChecks, ...taskChecks, ...fixtureFact];
  },
};

function attemptIdFrom(stdout: string): string {
  const value = JSON.parse(stdout) as {
    data?: { nodeBrief?: { attemptId?: unknown } };
  };
  const attemptId = value.data?.nodeBrief?.attemptId;
  if (typeof attemptId !== "string") {
    throw new Error("tc run returned no execute attempt id");
  }
  return attemptId;
}

export type ReviewSetup = CaseSetup;
export type ReviewExecution = CaseExecution;
