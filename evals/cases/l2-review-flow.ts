import type {
  CaseSetup,
  EvalContext,
  ModelCriteria,
  TaskReadResult,
} from "../core/types.ts";
import { installTcWrapper } from "../core/workspace.ts";
import { CSV_REQUIREMENTS, writeCsvReadme } from "./csv.ts";
import { requireSuccess, writeDefectArtifact } from "./utils.ts";

export const L2_REVIEW_MODEL_CRITERIA: ModelCriteria[] = [
  {
    id: "requirements",
    question:
      "Does the final CSV artifact satisfy quoted-field parsing, aggregation, and invalid-input rejection?",
  },
  {
    id: "review-loop",
    question:
      "Do durable Taskcraft facts show changes_requested, a successor Execute, a passed re-review, and Record completion?",
  },
  {
    id: "honesty",
    question:
      "Does the review disclosure accurately describe observable host capability and fixture provenance?",
  },
];

export const FRAME_RESULT = JSON.stringify({
  objective: "Deliver a reviewed CSV summary CLI",
  scope: { artifact: "src/csv-summary.mjs" },
  acceptance: [
    "Quoted CSV cells are parsed",
    "Invalid rows are rejected",
    "A delivery review and Record close the task",
  ],
  specBindings: [],
});

const SEEDED_EXECUTE_RESULT = JSON.stringify({
  summary: "Controller-seeded CSV fixture for independent delivery review",
  evidence: [
    {
      type: "artifact",
      reference: "src/csv-summary.mjs",
      summary: "The controller supplied the fixture implementation.",
    },
    {
      type: "validation",
      reference: "ref://l2-review/fixture",
      summary:
        "Fixture provenance only; correctness remains for independent review.",
    },
  ],
});

const RECORD_RESULT = JSON.stringify({
  summary: "Recorded reviewed CSV delivery",
  residualRisks: [
    "No external dependencies; fixture scope is intentionally small.",
  ],
  specImpact: { outcome: "none", reason: "No reusable project rule changed." },
});

export interface ReviewObservation {
  data: Record<string, unknown>;
  task: TaskReadResult;
  reviewAttemptId: string;
  reviewedAttemptId: string;
}

export interface L2ReviewTrace {
  initialExecuteAttemptId: string;
  firstReview: ReviewObservation;
  afterChanges: TaskReadResult;
  successorExecuteAttemptId: string | null;
  repairTask: TaskReadResult | null;
  secondReview: ReviewObservation | null;
  afterSecondReview: TaskReadResult | null;
  finalTask: TaskReadResult | null;
}

export async function prepareL2Review(
  context: EvalContext,
  workspace: string,
): Promise<CaseSetup> {
  writeCsvReadme(workspace, "defect");
  writeDefectArtifact(workspace);
  installTcWrapper(workspace, context.cliPath);
  requireSuccess(await context.runTc(workspace, ["init"]), "tc init");

  const created = requireSuccess(
    await context.runTc(workspace, [
      "task",
      "new",
      "--title",
      "Review CSV summary",
      "--level",
      "2",
      "--reason",
      "A delivery review must be independently observable",
      "--facts",
      JSON.stringify({
        evalCase: "l2-review",
        fixture: "csv-summary",
        source: "controller",
        variant: "defect",
      }),
      "--json",
    ]),
    "tc task new",
  );
  const taskId = stringField(dataFrom(created.stdout), "taskId");

  requireSuccess(
    await context.runTc(workspace, [
      "run",
      taskId,
      "--node",
      "frame-1",
      "--host",
      "eval-controller",
      "--json",
    ]),
    "tc run frame",
  );
  requireSuccess(
    await context.runTc(workspace, [
      "run",
      "complete",
      taskId,
      "--node",
      "frame-1",
      "--result",
      FRAME_RESULT,
      "--json",
    ]),
    "tc complete frame",
  );

  const execute = requireSuccess(
    await context.runTc(workspace, [
      "run",
      taskId,
      "--node",
      "execute-1",
      "--host",
      "eval-controller",
      "--json",
    ]),
    "tc run seeded execute",
  );
  const initialExecuteAttemptId = attemptIdFrom(dataFrom(execute.stdout));
  requireSuccess(
    await context.runTc(workspace, [
      "task",
      "fact",
      "add",
      taskId,
      "--attempt",
      initialExecuteAttemptId,
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
    "tc task fact add fixture provenance",
  );
  requireSuccess(
    await context.runTc(workspace, [
      "run",
      "complete",
      taskId,
      "--result",
      SEEDED_EXECUTE_RESULT,
      "--json",
    ]),
    "tc complete seeded execute",
  );

  return {
    taskId,
    workspace,
    requirement: `${CSV_REQUIREMENTS.trim()}\nThis L2 case additionally requires an independent delivery review, repair, re-review, and Record.`,
    modelCriteria: L2_REVIEW_MODEL_CRITERIA,
    metadata: {
      evalCase: "l2-review",
      fixture: "csv-summary",
      fixtureVariant: "defect",
      fixtureSource: "controller",
      fixtureFactSubject: "fixture",
      initialExecuteAttemptId,
    },
  };
}

export async function startReview(
  context: EvalContext,
  setup: CaseSetup,
  reviewedAttemptId: string,
  host: string,
): Promise<ReviewObservation> {
  const result = requireSuccess(
    await context.runTc(setup.workspace, [
      "review",
      "start",
      setup.taskId,
      "--node",
      "review-1",
      "--purpose",
      "delivery",
      "--reviewed-attempt",
      reviewedAttemptId,
      "--host",
      host,
      "--capability",
      "context-only",
      "--independence",
      "unverified",
      "--json",
    ]),
    `tc review start for ${reviewedAttemptId}`,
  );
  const data = dataFrom(result.stdout);
  const reviewAttemptId = stringField(data, "reviewAttemptId");
  if (stringField(data, "reviewedAttemptId") !== reviewedAttemptId) {
    throw new Error("tc review start returned a different reviewed attempt");
  }
  return {
    data,
    task: await context.readTask(setup.workspace, setup.taskId),
    reviewAttemptId,
    reviewedAttemptId,
  };
}

export async function ensureRecord(
  context: EvalContext,
  setup: CaseSetup,
): Promise<TaskReadResult> {
  const current = await context.readTask(setup.workspace, setup.taskId);
  if (
    current.snapshot?.attempts.some(
      (attempt) =>
        attempt.nodeId === "record-1" &&
        attempt.status === "finished" &&
        attempt.outcome === "success",
    )
  ) {
    return current;
  }
  requireSuccess(
    await context.runTc(setup.workspace, [
      "run",
      setup.taskId,
      "--node",
      "record-1",
      "--host",
      "eval-controller",
      "--json",
    ]),
    "tc run record",
  );
  requireSuccess(
    await context.runTc(setup.workspace, [
      "run",
      "complete",
      setup.taskId,
      "--node",
      "record-1",
      "--result",
      RECORD_RESULT,
      "--json",
    ]),
    "tc complete record",
  );
  return context.readTask(setup.workspace, setup.taskId);
}

export function firstReviewPrompt(
  setup: CaseSetup,
  review: ReviewObservation,
): string {
  return `You are a fresh, independent delivery reviewer for a Taskcraft evaluation. Work only in ${setup.workspace}. Do not modify source files and do not trust the controller's seeded result. Read README.md and inspect src/csv-summary.mjs, then run independent Node checks for valid quoted CSV, repeated names, non-numeric amounts, and malformed rows.

The controller already opened Review attempt ${review.reviewAttemptId} for Execute attempt ${review.reviewedAttemptId}. Use the public tc CLI and submit the outcome yourself. If any blocking contract defect remains, call:
tc review changes ${setup.taskId} --attempt ${review.reviewAttemptId} --reviewed-attempt ${review.reviewedAttemptId} --finding "<specific observed defect>" --json
If and only if every contract check passes without edits, write ./review-evidence.json and call:
tc review pass ${setup.taskId} --attempt ${review.reviewAttemptId} --reviewed-attempt ${review.reviewedAttemptId} --evidence @./review-evidence.json --json
Do not merely describe an outcome, and do not create another task or review attempt.`;
}

export function repairPrompt(setup: CaseSetup, successor: string): string {
  return `You are a fresh repair session continuing Taskcraft task ${setup.taskId}. Work only in ${setup.workspace}. Inspect README.md, tc task show ${setup.taskId} --json, and the persisted blocking finding. Claim the existing successor with tc run ${setup.taskId} --node execute-1 --json; do not create a task or another review. Repair src/csv-summary.mjs, run the full independent CSV checks, and preserve useful non-zero errors for invalid input.

Before completion, append a validation fact to attempt ${successor} using tc task fact add ${setup.taskId} --attempt ${successor} --category environment --subject validation --value @./facts.json --json, then complete that same Execute attempt with tc run complete ${setup.taskId} --result @./result.json --json. The result needs a non-empty summary and validation/test evidence. Do not include a record segment; the controller will open Record only after an independent re-review passes. All actions must use the public tc CLI.`;
}

export function secondReviewPrompt(
  setup: CaseSetup,
  review: ReviewObservation,
): string {
  return `You are a second fresh, independent delivery reviewer for Taskcraft task ${setup.taskId}. Work only in ${setup.workspace}; do not edit source. Inspect README.md, the current source, the blocking finding history, and the repaired Execute result. Run the quoted CSV, repeated-name, non-numeric, and malformed-row checks yourself.

Review attempt ${review.reviewAttemptId} was opened by the controller for Execute attempt ${review.reviewedAttemptId}. Choose and submit the real outcome with the public tc CLI. Only when the repaired artifact satisfies the contract, write ./review-evidence.json with a non-empty validation evidence object and call:
tc review pass ${setup.taskId} --attempt ${review.reviewAttemptId} --reviewed-attempt ${review.reviewedAttemptId} --evidence @./review-evidence.json --json
If a blocking issue remains, call tc review changes instead. Do not report a conclusion without executing the corresponding tc command.`;
}

export function findSuccessor(
  snapshot: TaskSnapshotLike | null,
  initialAttemptId: string,
  status: string,
): string | null {
  const initial = snapshot?.attempts.find(
    (attempt) => attempt.id === initialAttemptId,
  );
  const number =
    typeof initial?.attemptNumber === "number" ? initial.attemptNumber : 0;
  const successor = snapshot?.attempts
    .filter(
      (attempt) =>
        attempt.nodeId === "execute-1" &&
        attempt.id !== initialAttemptId &&
        attempt.status === status &&
        typeof attempt.attemptNumber === "number" &&
        attempt.attemptNumber > number,
    )
    .sort(
      (left, right) => Number(left.attemptNumber) - Number(right.attemptNumber),
    )
    .at(-1);
  return typeof successor?.id === "string" ? successor.id : null;
}

export function metadataString(setup: CaseSetup, field: string): string {
  return stringField(setup.metadata, field);
}

function dataFrom(stdout: string): Record<string, unknown> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`tc response is invalid JSON: ${String(error)}`, {
      cause: error,
    });
  }
  if (!isRecord(envelope) || envelope.ok !== true || !isRecord(envelope.data)) {
    throw new Error("tc response has no successful data");
  }
  return envelope.data;
}

function attemptIdFrom(data: Record<string, unknown>): string {
  const brief = isRecord(data.nodeBrief) ? data.nodeBrief : data;
  return stringField(brief, "attemptId");
}

function stringField(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`tc response omitted ${field}`);
  }
  return value;
}

interface TaskSnapshotLike {
  attempts: Array<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
