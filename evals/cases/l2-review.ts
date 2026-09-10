import type {
  CaseExecution,
  CaseSetup,
  EvalCase,
  EvalContext,
  HostRun,
  TaskReadResult,
} from "../core/types.ts";
import {
  ensureRecord,
  firstReviewPrompt,
  findSuccessor,
  metadataString,
  prepareL2Review,
  repairPrompt,
  secondReviewPrompt,
  startReview,
  L2_REVIEW_MODEL_CRITERIA,
  type L2ReviewTrace,
} from "./l2-review-flow.ts";
import { gradeL2Review } from "./l2-review-grade.ts";
import {
  buildL2ReviewJudgeEvidence,
  type L2ReviewJudgeEvidence,
} from "./l2-review-evidence.ts";

export interface L2ReviewExecution extends CaseExecution {
  reviewTrace: L2ReviewTrace;
  judgeEvidence: L2ReviewJudgeEvidence;
}

export const l2ReviewCase = {
  id: "l2-review",
  title: "L2 CSV review and repair",
  description:
    "Seed a small defective CSV implementation, run an independent delivery review, repair its successor Execute attempt, re-review it, and record the closure.",
  requirements:
    "Use the public tc CLI for an L2 Frame, Execute, delivery Review, successor Execute, re-review, and Record. A real independent host must choose changes_requested for the seeded defect; a fresh repair host must fix the artifact; a fresh reviewer must submit passed with evidence. Preserve controller fixture provenance and all attempt, finding, review association, and evidence history.",
  modelCriteria: L2_REVIEW_MODEL_CRITERIA,
  prepare: prepareL2Review,
  execute: async (
    context: EvalContext,
    setup: CaseSetup,
    timeoutMs: number,
    model: string | undefined,
  ): Promise<L2ReviewExecution> => {
    const hostRuns: HostRun[] = [];
    const initialExecute = metadataString(setup, "initialExecuteAttemptId");
    const firstReview = await startReview(
      context,
      setup,
      initialExecute,
      "eval-independent-reviewer-1",
    );
    hostRuns.push(
      await context.host.run(
        {
          cwd: setup.workspace,
          prompt: firstReviewPrompt(setup, firstReview),
          timeoutMs,
          ...(model === undefined ? {} : { model }),
        },
        "l2-reviewer-initial",
      ),
    );

    const afterChanges = await context.readTask(setup.workspace, setup.taskId);
    const successor = findSuccessor(
      afterChanges.snapshot,
      initialExecute,
      "created",
    );
    const trace: L2ReviewTrace = {
      initialExecuteAttemptId: initialExecute,
      firstReview,
      afterChanges,
      successorExecuteAttemptId: successor,
      repairTask: null,
      secondReview: null,
      afterSecondReview: null,
      finalTask: null,
    };
    if (
      successor === null ||
      !hasAttempt(
        afterChanges,
        firstReview.reviewAttemptId,
        "review-1",
        "changes_requested",
      )
    ) {
      return {
        hostRuns,
        reviewTrace: trace,
        judgeEvidence: buildL2ReviewJudgeEvidence(trace),
      };
    }

    hostRuns.push(
      await context.host.run(
        {
          cwd: setup.workspace,
          prompt: repairPrompt(setup, successor),
          timeoutMs,
          ...(model === undefined ? {} : { model }),
        },
        "l2-repair",
      ),
    );
    trace.repairTask = await context.readTask(setup.workspace, setup.taskId);
    if (!hasAttempt(trace.repairTask, successor, "execute-1", "success")) {
      return {
        hostRuns,
        reviewTrace: trace,
        judgeEvidence: buildL2ReviewJudgeEvidence(trace),
      };
    }

    const secondReview = await startReview(
      context,
      setup,
      successor,
      "eval-independent-reviewer-2",
    );
    trace.secondReview = secondReview;
    hostRuns.push(
      await context.host.run(
        {
          cwd: setup.workspace,
          prompt: secondReviewPrompt(setup, secondReview),
          timeoutMs,
          ...(model === undefined ? {} : { model }),
        },
        "l2-reviewer-final",
      ),
    );
    trace.afterSecondReview = await context.readTask(
      setup.workspace,
      setup.taskId,
    );
    if (
      !hasAttempt(
        trace.afterSecondReview,
        secondReview.reviewAttemptId,
        "review-1",
        "passed",
      )
    ) {
      return {
        hostRuns,
        reviewTrace: trace,
        judgeEvidence: buildL2ReviewJudgeEvidence(trace),
      };
    }

    trace.finalTask = await ensureRecord(context, setup);
    return {
      hostRuns,
      reviewTrace: trace,
      judgeEvidence: buildL2ReviewJudgeEvidence(trace),
    };
  },
  grade: (
    _context: EvalContext,
    setup: CaseSetup,
    execution: CaseExecution,
    task: TaskReadResult,
  ) => gradeL2Review(setup, execution, task),
} satisfies EvalCase;

function hasAttempt(
  result: TaskReadResult | null,
  id: string,
  nodeId: string,
  outcome: string,
): boolean {
  return Boolean(
    result?.snapshot?.attempts.some(
      (attempt) =>
        attempt.id === id &&
        attempt.nodeId === nodeId &&
        attempt.status === "finished" &&
        attempt.outcome === outcome,
    ),
  );
}
