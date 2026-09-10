import type {
  CaseExecution,
  CaseSetup,
  CheckResult,
  EvalCase,
  EvalContext,
  HostRun,
  ModelCriteria,
  TaskReadResult,
} from "../core/types.ts";
import { gradeCsvArtifact, gradeTaskContract } from "./csv.ts";
import { prepareCsvTask } from "./utils.ts";

const HANDOFF_FACT_SUBJECT = "session-handoff";

const MODEL_CRITERIA: ModelCriteria[] = [
  {
    id: "requirements",
    question:
      "Does the second session finish the CSV contract from durable workspace and Taskcraft state rather than from carried context?",
  },
  {
    id: "continuity",
    question:
      "Does the final result continue the original task and execute attempt instead of creating a replacement attempt?",
  },
  {
    id: "honesty",
    question:
      "Does the evidence distinguish a normal first-session handoff from an interrupted recovery checkpoint?",
  },
];

type SourceFile = Awaited<ReturnType<EvalContext["hashSources"]>>[number];

export interface SessionResumeJudgeEvidence {
  kind: "session-resume";
  [key: string]: unknown;
  established: boolean;
  taskId: string;
  firstHostPhase: string;
  firstHostStatus: HostRun["status"];
  firstTaskStatus: string | null;
  firstAttemptId: string | null;
  sourceFilesBefore: SourceFile[];
  sourceFilesAfterFirst: SourceFile[];
  handoffFactId: string | null;
  reason: string;
  finalTask: {
    available: boolean;
    taskId: string | null;
    status: string | null;
    error: string | null;
  };
}

type SessionResumeSetup = CaseSetup & {
  metadata: CaseSetup["metadata"] & {
    sessionResume: SessionResumeMetadata;
  };
};

interface SessionResumeMetadata {
  handoffFactSubject: string;
  evidence: SessionResumeEvidence | null;
}

interface SessionResumeEvidence {
  established: boolean;
  taskId: string;
  firstAttemptId: string | null;
  firstHostStatus: HostRun["status"];
  firstTaskStatus: string | null;
  initialSourceFiles: SourceFile[];
  sourceFilesAfterFirst: SourceFile[];
  handoffFactId: string | null;
  capturedAt: string;
  reason: string;
}

export const sessionResumeCase: EvalCase = {
  id: "session-resume",
  title: "Normal-session resume",
  description:
    "End one host session normally with unfinished work, then let a new session resume the same Taskcraft attempt from durable state.",
  requirements:
    "The first host must exit successfully after making verifiable source changes and recording a persistent handoff fact, while the task and its execute attempt remain unfinished. A fresh second host must discover the task through README.md and the public tc task list/show commands, continue that same execute attempt, and finish independently verified work.",
  modelCriteria: MODEL_CRITERIA,
  prepare: async (context, workspace) => {
    const setup = await prepareCsvTask(
      context,
      workspace,
      "Resume CSV delivery after a normal session",
      "empty",
      { evalCase: "session-resume", fixture: "csv-summary" },
    );
    return {
      ...setup,
      modelCriteria: MODEL_CRITERIA,
      metadata: {
        ...setup.metadata,
        sessionResume: {
          handoffFactSubject: HANDOFF_FACT_SUBJECT,
          evidence: null,
        },
      },
    } as SessionResumeSetup;
  },
  execute: async (context, setup, actorTimeoutMs, model) => {
    const sessionSetup = asSessionResumeSetup(setup);
    const initialSourceFiles = await context.hashSources(setup.workspace);
    const first = await context.host.run(
      {
        cwd: setup.workspace,
        prompt: firstSessionPrompt(sessionSetup),
        timeoutMs: actorTimeoutMs,
        ...(model === undefined ? {} : { model }),
      },
      "session-resume-first-session",
    );

    const firstTask = await context.readTask(setup.workspace, setup.taskId);
    const sourceFilesAfterFirst = await context.hashSources(setup.workspace);
    const evidence = establishEvidence(
      setup.taskId,
      first,
      initialSourceFiles,
      sourceFilesAfterFirst,
      firstTask,
    );
    sessionSetup.metadata.sessionResume.evidence = evidence;

    const judgeEvidence = buildJudgeEvidence(evidence, first, firstTask);
    if (!evidence.established) {
      return { hostRuns: [first], judgeEvidence };
    }

    const second = await context.host.run(
      {
        cwd: setup.workspace,
        prompt: secondSessionPrompt(),
        timeoutMs: actorTimeoutMs,
        ...(model === undefined ? {} : { model }),
      },
      "session-resume-second-session",
    );
    const finalTask = await context.readTask(setup.workspace, setup.taskId);
    return {
      hostRuns: [first, second],
      judgeEvidence: buildJudgeEvidence(evidence, first, finalTask),
    };
  },
  grade: async (_context, setup, execution, task) => {
    const sessionSetup = asSessionResumeSetup(setup);
    if (sessionSetup.metadata.sessionResume.evidence?.established !== true) {
      return gradeSessionResume(sessionSetup, execution, task);
    }
    const artifactChecks = await gradeCsvArtifact(setup.workspace);
    const taskChecks = gradeTaskContract(
      task.snapshot,
      task.error,
      HANDOFF_FACT_SUBJECT,
    );
    return [
      ...artifactChecks,
      ...taskChecks,
      ...gradeSessionResume(sessionSetup, execution, task),
    ];
  },
};

function establishEvidence(
  taskId: string,
  first: HostRun,
  initialSourceFiles: SourceFile[],
  sourceFilesAfterFirst: SourceFile[],
  task: TaskReadResult,
): SessionResumeEvidence {
  const snapshot = task.snapshot;
  const attempt = snapshot?.attempts.find(
    (candidate) =>
      candidate.nodeId === "execute-1" &&
      (candidate.status === "created" || candidate.status === "running"),
  );
  const firstAttemptId = stringValue(attempt?.id);
  const handoffFact = snapshot?.facts.find(
    (candidate) =>
      candidate.subject === HANDOFF_FACT_SUBJECT &&
      candidate.sourceAttemptId === firstAttemptId,
  );
  const changed = hasMeaningfulSourceChange(
    initialSourceFiles,
    sourceFilesAfterFirst,
  );
  const unfinished =
    snapshot !== null &&
    snapshot.taskId === taskId &&
    snapshot.status !== "done";
  const established =
    first.status === "success" &&
    unfinished &&
    attempt !== undefined &&
    firstAttemptId !== null &&
    changed &&
    handoffFact !== undefined;

  return {
    established,
    taskId,
    firstAttemptId,
    firstHostStatus: first.status,
    firstTaskStatus: snapshot?.status ?? null,
    initialSourceFiles,
    sourceFilesAfterFirst,
    handoffFactId: stringValue(handoffFact?.id),
    capturedAt: new Date().toISOString(),
    reason: established
      ? "first host exited successfully after a meaningful source change and handoff fact while the original execute attempt remained open"
      : evidenceFailureReason(
          first,
          snapshot,
          attempt,
          changed,
          handoffFact,
          task.error,
        ),
  };
}

function buildJudgeEvidence(
  evidence: SessionResumeEvidence,
  first: HostRun,
  finalTask: TaskReadResult,
): SessionResumeJudgeEvidence {
  return {
    kind: "session-resume",
    established: evidence.established,
    taskId: evidence.taskId,
    firstHostPhase: first.phase,
    firstHostStatus: first.status,
    firstTaskStatus: evidence.firstTaskStatus,
    firstAttemptId: evidence.firstAttemptId,
    sourceFilesBefore: evidence.initialSourceFiles,
    sourceFilesAfterFirst: evidence.sourceFilesAfterFirst,
    handoffFactId: evidence.handoffFactId,
    reason: evidence.reason,
    finalTask: {
      available: finalTask.snapshot !== null,
      taskId: finalTask.snapshot?.taskId ?? null,
      status: finalTask.snapshot?.status ?? null,
      error: finalTask.error,
    },
  };
}

function gradeSessionResume(
  setup: SessionResumeSetup,
  execution: CaseExecution,
  task: TaskReadResult,
): CheckResult[] {
  const evidence = setup.metadata.sessionResume.evidence;
  if (evidence?.established !== true) {
    return [
      check(
        "session-resume-handoff",
        "inconclusive",
        "a normal first-session handoff was not established",
        evidence?.reason ?? "handoff evidence was absent",
      ),
    ];
  }

  const first = execution.hostRuns[0];
  const second = execution.hostRuns[1];
  const checks: CheckResult[] = [
    check(
      "session-resume-handoff",
      first?.status === "success" ? "pass" : "fail",
      first?.status === "success"
        ? "the first host exited normally with unfinished durable work"
        : "the first host did not exit successfully",
      `${evidence.taskId}; status=${first?.status ?? "missing"}; task=${evidence.firstTaskStatus ?? "missing"}; attempt=${evidence.firstAttemptId ?? "missing"}`,
    ),
    check(
      "session-resume-second-session",
      second?.status === "success" ? "pass" : "fail",
      second?.status === "success"
        ? "a separate second host session completed successfully"
        : "the second host session did not complete successfully",
      `first=${first?.phase ?? "missing"}; second=${second?.phase ?? "missing"}; status=${second?.status ?? "missing"}`,
    ),
  ];

  const snapshot = task.snapshot;
  if (snapshot === null) {
    checks.push(
      check(
        "session-resume-task-identity",
        "inconclusive",
        "the final task snapshot was unavailable",
        task.error ?? "tc task show returned no snapshot",
      ),
      check(
        "session-resume-attempt-identity",
        "inconclusive",
        "the final attempt relationship could not be verified",
        "task snapshot was unavailable",
      ),
    );
    return checks;
  }

  const executeAttempts = snapshot.attempts.filter(
    (attempt) => attempt.nodeId === "execute-1",
  );
  const finalAttempt = executeAttempts.find(
    (attempt) => attempt.id === evidence.firstAttemptId,
  );
  checks.push(
    check(
      "session-resume-task-identity",
      snapshot.taskId === setup.taskId ? "pass" : "fail",
      snapshot.taskId === setup.taskId
        ? "the second session completed the original task id"
        : "the final snapshot belongs to a different task id",
      `expected=${setup.taskId}; actual=${snapshot.taskId}`,
    ),
    check(
      "session-resume-attempt-identity",
      executeAttempts.length === 1 &&
        finalAttempt?.id === evidence.firstAttemptId &&
        finalAttempt.status === "finished" &&
        finalAttempt.outcome === "success"
        ? "pass"
        : "fail",
      executeAttempts.length === 1 &&
        finalAttempt?.id === evidence.firstAttemptId &&
        finalAttempt.status === "finished" &&
        finalAttempt.outcome === "success"
        ? "the original execute attempt was continued and finished successfully"
        : "the final state does not prove continuation of the original execute attempt",
      `first=${evidence.firstAttemptId ?? "missing"}; executeAttempts=${executeAttempts.map((attempt) => `${String(attempt.id)}:${String(attempt.status)}/${String(attempt.outcome)}`).join(", ") || "none"}`,
    ),
  );
  return checks;
}

function firstSessionPrompt(setup: SessionResumeSetup): string {
  return `You are the first implementation session for a Taskcraft evaluation. Work only in the current fixture directory and use the public tc CLI.

${setup.requirement}

Start the task with: tc run ${setup.taskId} --node execute-1 --json. Make a meaningful source change in src/ and run at least one independent check, but leave the implementation unfinished for a later session. Read the current execute attempt id from tc task show ${setup.taskId} --json. Write a plain JSON handoff value to ./handoff.json and append it with: tc task fact add ${setup.taskId} --attempt <attempt-id> --category environment --subject ${HANDOFF_FACT_SUBJECT} --value @./handoff.json --json.

End this host session normally after the handoff is recorded. Do not run tc run complete, do not finish the task, and do not wait for or simulate an interruption. The next session must recover from README.md and durable tc state.`;
}

function secondSessionPrompt(): string {
  return `You are a new implementation session with no prior chat context. The task id, original request, and previous conversation are intentionally unavailable in this prompt. Recover the work only from the current workspace and the public tc CLI.

Read README.md for the contract. Use tc task list --json to find the unfinished task, then use tc task show <task-id> --json to inspect its existing execute attempt and durable facts. Inspect the current source and continue the already-open execute attempt; do not invoke tc run to create another attempt. Finish the implementation, run the complete checks from README.md, and record validation evidence on that same attempt.

Write the validation fact value to ./resume-validation.json and add it with tc task fact add <task-id> --attempt <attempt-id> --category environment --subject resume-validation --value @./resume-validation.json --json. Write a valid execute result to ./result.json using the schema shown by task show, then run tc run complete <task-id> --result @./result.json --json. Keep all changes in the fixture workspace.`;
}

function evidenceFailureReason(
  first: HostRun,
  snapshot: TaskReadResult["snapshot"],
  attempt: Record<string, unknown> | undefined,
  changed: boolean,
  handoffFact: Record<string, unknown> | undefined,
  taskError: string | null,
): string {
  const failures: string[] = [];
  if (first.status !== "success")
    failures.push(`first host status=${first.status}`);
  if (snapshot === null)
    failures.push(taskError ?? "task snapshot unavailable");
  else if (snapshot.status === "done") failures.push("task was already done");
  if (attempt === undefined) failures.push("no open execute attempt");
  if (!changed) failures.push("no meaningful source change");
  if (handoffFact === undefined)
    failures.push(
      "session-handoff fact was absent or bound to another attempt",
    );
  return (
    failures.join("; ") ||
    "normal-session handoff conditions were not all observed"
  );
}

function hasMeaningfulSourceChange(
  before: SourceFile[],
  after: SourceFile[],
): boolean {
  const prior = new Map(before.map((file) => [file.path, file]));
  return after.some((file) => {
    const old = prior.get(file.path);
    return (
      file.bytes >= 40 && (old === undefined || old.sha256 !== file.sha256)
    );
  });
}

function asSessionResumeSetup(setup: CaseSetup): SessionResumeSetup {
  const metadata = setup.metadata as Partial<SessionResumeMetadata> & {
    sessionResume?: SessionResumeMetadata;
  };
  if (metadata.sessionResume === undefined) {
    throw new Error("session-resume setup metadata is missing");
  }
  return setup as SessionResumeSetup;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function check(
  id: string,
  verdict: CheckResult["verdict"],
  reason: string,
  evidence: string,
): CheckResult {
  return { id, grader: "code", verdict, reason, evidence: [evidence] };
}

export type SessionResumeSetupData = SessionResumeSetup;
export type SessionResumeEvidenceData = SessionResumeEvidence;
