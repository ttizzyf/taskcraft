import type {
  CaseExecution,
  CaseSetup,
  CheckResult,
  CheckpointEvidence,
  EvalCase,
  ModelCriteria,
} from "../core/types.ts";
import { gradeCsvArtifact, gradeTaskContract } from "./csv.ts";
import { actorPrompt, prepareCsvTask } from "./utils.ts";

const MODEL_CRITERIA: ModelCriteria[] = [
  {
    id: "requirements",
    question:
      "Does the second session finish a correct quoted-CSV implementation rather than merely describing one?",
  },
  {
    id: "scope",
    question:
      "Does the recovery work remain within the fixture's requested scope?",
  },
  {
    id: "honesty",
    question:
      "Does the report distinguish the first-session checkpoint from the second-session completion evidence?",
  },
];

export const recoveryCase: EvalCase = {
  id: "recovery",
  title: "Interrupt and new-session recovery",
  description:
    "Create a real execute checkpoint in one session, interrupt it, and finish from a fresh session.",
  requirements:
    "The first actor session must create source changes while an execute attempt is open; only then may a fresh second session continue and close the task.",
  modelCriteria: MODEL_CRITERIA,
  prepare: async (context, workspace) => {
    const setup = await prepareCsvTask(
      context,
      workspace,
      "Recover interrupted CSV delivery",
      "empty",
      { evalCase: "recovery", fixture: "csv-summary" },
    );
    return { ...setup, modelCriteria: MODEL_CRITERIA };
  },
  execute: async (context, setup, actorTimeoutMs, model) => {
    const initialSourceFiles = await context.hashSources(setup.workspace);
    let checkpoint: CheckpointEvidence | undefined;
    const probe = async (): Promise<boolean> => {
      if (checkpoint !== undefined) return true;
      const task = await context.readTask(setup.workspace, setup.taskId);
      if (task.snapshot === null) return false;
      const sourceFiles = await context.hashSources(setup.workspace);
      const openExecute = task.snapshot.attempts.some(
        (attempt) =>
          attempt.nodeId === "execute-1" &&
          (attempt.status === "created" || attempt.status === "running"),
      );
      const changed = hasSourceChange(initialSourceFiles, sourceFiles);
      if (!openExecute || !changed) return false;
      checkpoint = {
        established: true,
        initialSourceFiles,
        sourceFiles,
        taskStatus: task.snapshot.status,
        attemptIds: task.snapshot.attempts
          .map((attempt) => attempt.id)
          .filter((id): id is string => typeof id === "string"),
        capturedAt: new Date().toISOString(),
        reason: "source changed while the real execute attempt remained open",
      };
      return true;
    };

    const first = await context.host.run(
      {
        cwd: setup.workspace,
        prompt: actorPrompt(
          setup,
          "checkpoint",
          "This is the first session only. Start the execute attempt, make a meaningful source change, and run at least one check. Append the checkpoint fact. Do not run tc run complete. Keep the attempt open so the controller can interrupt this real session after it observes the checkpoint.",
        ),
        timeoutMs: actorTimeoutMs,
        pollMs: 250,
        stopWhen: probe,
        ...(model === undefined ? {} : { model }),
      },
      "recovery-first-session",
    );
    if (checkpoint === undefined) await probe();
    if (checkpoint === undefined || first.status !== "interrupted") {
      const observed = checkpoint;
      return {
        hostRuns: [first],
        checkpoint: {
          established: false,
          initialSourceFiles,
          sourceFiles:
            observed?.sourceFiles ??
            (await context.hashSources(setup.workspace)),
          taskStatus: observed?.taskStatus ?? null,
          attemptIds: observed?.attemptIds ?? [],
          capturedAt: observed?.capturedAt ?? new Date().toISOString(),
          reason:
            observed === undefined
              ? "no open execute attempt and changed source were observed together"
              : `checkpoint was observed, but the controller did not interrupt the first session (status=${first.status})`,
        },
      };
    }

    const second = await context.host.run(
      {
        cwd: setup.workspace,
        prompt: recoveryContinuationPrompt(),
        timeoutMs: actorTimeoutMs,
        ...(model === undefined ? {} : { model }),
      },
      "recovery-second-session",
    );
    return { hostRuns: [first, second], checkpoint };
  },
  grade: async (_context, setup, execution, task) => {
    const artifactChecks = await gradeCsvArtifact(setup.workspace);
    if (execution.checkpoint?.established !== true) {
      return [
        ...artifactChecks,
        check(
          "recovery-checkpoint",
          "inconclusive",
          "the controller did not establish a real interruption checkpoint",
          execution.checkpoint?.reason ?? "checkpoint evidence was absent",
        ),
      ];
    }
    const taskChecks = gradeTaskContract(
      task.snapshot,
      task.error,
      "validation",
    );
    return [
      ...artifactChecks,
      ...taskChecks,
      check(
        "recovery-checkpoint",
        "pass",
        "a changed source and open execute attempt were captured before the fresh session",
        `${execution.checkpoint.sourceFiles.map((file) => file.path).join(", ")}; ${execution.checkpoint.attemptIds.join(", ")}`,
      ),
    ];
  },
};

function recoveryContinuationPrompt(): string {
  return `You are a fresh implementation session continuing an unfinished Taskcraft fixture. You have no previous chat context and must recover the work from durable state, not from this prompt.

Inspect README.md for the public contract. Use the public tc CLI to list unfinished tasks with tc task list --json, then inspect the relevant task with tc task show <task-id> --json. Continue the existing open execute attempt; do not claim a second execute attempt. Inspect the current files, run the complete contract checks from README.md, fix any remaining issues, and record validation evidence.

Before completing, append the required validation fact to the existing execute attempt. Write the fact value to ./facts.json and use tc task fact add <task-id> --attempt <attempt-id> --category environment --subject validation --value @./facts.json --json. Write the completion JSON to ./result.json using the execute result schema shown by the task state, then run tc run complete <task-id> --result @./result.json --json. Keep all changes inside the fixture workspace.`;
}

function hasSourceChange(
  before: Array<{ path: string; sha256: string; bytes: number }>,
  after: Array<{ path: string; sha256: string; bytes: number }>,
): boolean {
  const prior = new Map(before.map((file) => [file.path, file]));
  return after.some((file) => {
    const old = prior.get(file.path);
    return (
      file.bytes >= 40 && (old === undefined || old.sha256 !== file.sha256)
    );
  });
}

function check(
  id: string,
  verdict: CheckResult["verdict"],
  reason: string,
  evidence: string,
): CheckResult {
  return { id, grader: "code", verdict, reason, evidence: [evidence] };
}

export type RecoverySetup = CaseSetup;
export type RecoveryExecution = CaseExecution;
