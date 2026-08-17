// Shared fixtures and helpers for the L3 reducer/projector test suites:
// the result documents accepted by the L3 node schemas, the review input
// builder, the review pass helper and the reducer driver up to the
// feasibility review point.

import type { TaskcraftDatabase } from "../../src/store/database.js";
import {
  reviewPass,
  reviewReplan,
  reviewStart,
  run,
  runComplete,
  taskNew,
} from "../../src/core/reducer.js";
import { getEvidence, getTask } from "../../src/store/query.js";

export const L3_FRAME_RESULT = {
  objective: "Ship the L3 initiative",
  scope: ["core", "cli"],
  acceptanceAnchors: [
    { id: "A-01", text: "Every module has an independent lifecycle" },
    { id: "A-02", text: "The parent integrates only completed children" },
  ],
  nonGoals: ["Taskcraft does not schedule subagents"],
};

export const L3_PLAN_RESULT = {
  decomposition: {
    mode: "modules" as const,
    reason: "The storage and projection modules are independently testable",
    attemptedSplits: [],
  },
  modules: [
    {
      key: "contract",
      title: "Child contract",
      level: 2 as const,
      reason: "The storage contract needs its own review",
      objective: "Deliver the child contract",
      scope: ["migrations", "store"],
      acceptance: ["The contract is queryable"],
      nonGoals: ["No UI work"],
      covers: ["A-01"],
      reviewFocus: ["foreign keys"],
    },
    {
      key: "projection",
      title: "Child projection",
      level: 1 as const,
      reason: "The projection is a separate deliverable",
      objective: "Deliver the parent projection",
      scope: ["projector"],
      acceptance: ["The parent gate is correct"],
      nonGoals: ["No scheduling"],
      covers: ["A-02"],
      reviewFocus: ["status precedence"],
    },
  ],
  coverage: [
    {
      anchorId: "A-01",
      disposition: "required" as const,
      moduleKeys: ["contract"],
    },
    {
      anchorId: "A-02",
      disposition: "required" as const,
      moduleKeys: ["projection"],
    },
  ],
  dependencies: [{ task: "projection", dependsOn: "contract" }],
  executionMode: "serial" as const,
  sharedValidations: [
    { id: "full-check", reference: "pnpm check", owner: "parent-integrate" },
  ],
  integrationPath: "integrate://deliverables",
};

export const L3_SINGLE_PLAN_RESULT = {
  decomposition: {
    mode: "single" as const,
    reason: "The delivery is one atomic migration",
    attemptedSplits: [
      {
        proposal: "Separate migration and verification",
        failureReason: "Verification is part of the same atomic cutover",
      },
    ],
  },
  modules: [],
  coverage: L3_FRAME_RESULT.acceptanceAnchors.map((anchor) => ({
    anchorId: anchor.id,
    disposition: "required" as const,
    moduleKeys: [],
  })),
  dependencies: [],
  executionMode: "serial" as const,
  sharedValidations: [
    { id: "full-check", reference: "pnpm check", owner: "parent-integrate" },
  ],
  integrationPath: "integrate://single-deliverable",
};

export const L3_EXECUTE_RESULT = {
  summary: "Child A delivered",
  evidence: [
    { type: "validation", reference: "ref://validation", summary: "Validated" },
    { type: "test", reference: "ref://test", summary: "Tests pass" },
  ],
};

export function reviewInput(
  taskId: string,
  nodeId: string,
  reviewedAttemptId: string,
  purpose: "feasibility" | "delivery" | "integration",
) {
  return {
    taskId,
    nodeId,
    purpose,
    reviewedAttemptId,
    capability: "context-only" as const,
    independenceStatus: "same-actor" as const,
  };
}

export function passReview(
  db: TaskcraftDatabase,
  taskId: string,
  reviewAttemptId: string,
  reviewedAttemptId: string,
) {
  return reviewPass(db, taskId, {
    taskId,
    attemptId: reviewAttemptId,
    reviewedAttemptId,
    evidence: [
      { type: "validation", reference: "ref://review", summary: "Reviewed" },
    ],
  });
}

export function completeModuleChildren(
  db: TaskcraftDatabase,
  parentTaskId: string,
): string[] {
  const children = projectChildren(db, parentTaskId);
  const reviewedChild = children[0]!;
  run(db, reviewedChild, { nodeId: "execute-1" });
  runComplete(db, reviewedChild, { result: L3_EXECUTE_RESULT });
  const review = reviewStart(
    db,
    reviewedChild,
    reviewInput(
      reviewedChild,
      "review-1",
      `att-${reviewedChild}-execute-1-1`,
      "delivery",
    ),
  );
  passReview(
    db,
    reviewedChild,
    review.reviewAttemptId,
    `att-${reviewedChild}-execute-1-1`,
  );
  run(db, reviewedChild, { nodeId: "record-1" });
  runComplete(db, reviewedChild, {
    nodeId: "record-1",
    result: { summary: "Reviewed child recorded" },
  });

  const simpleChild = children[1]!;
  run(db, simpleChild, { nodeId: "execute-1" });
  runComplete(db, simpleChild, {
    result: {
      ...L3_EXECUTE_RESULT,
      record: { summary: "Simple child recorded" },
    },
  });
  return children;
}

export function integrateResult(
  db: TaskcraftDatabase,
  childTaskIds: string[],
  modifiedDeliverables: boolean,
) {
  return {
    childrenResults: childTaskIds.map((taskId) => ({
      taskId,
      taskRevision: getTask(db, taskId)!.revision,
      evidenceRefs: [getEvidence(db, taskId)[0]!.id],
    })),
    integrationEvidence: modifiedDeliverables
      ? [
          {
            type: "test" as const,
            reference: "ref://integration",
            summary: "Integration passes",
          },
        ]
      : [],
    modifiedDeliverables,
  };
}

function projectChildren(
  db: TaskcraftDatabase,
  parentTaskId: string,
): string[] {
  return db
    .prepare(
      `SELECT child_task_id AS taskId FROM lifecycle_child_requirements
       WHERE parent_task_id = ? AND requirement_status = 'required'
       ORDER BY order_index`,
    )
    .all(parentTaskId)
    .map((row) => (row as { taskId: string }).taskId);
}

/** Drives an L3 task through the reducer up to the feasibility review
 * (frame and plan finished, review-plan-1 runnable). */
export function setupL3ToFeasibility(
  db: TaskcraftDatabase,
  planResult: unknown = L3_PLAN_RESULT,
): {
  taskId: string;
  planAttemptId: string;
} {
  const { taskId } = taskNew(db, {
    title: "L3 card",
    level: 3,
    reason: "reason",
  });
  run(db, taskId, { nodeId: "frame-1" });
  runComplete(db, taskId, { nodeId: "frame-1", result: L3_FRAME_RESULT });
  run(db, taskId, { nodeId: "plan-1" });
  runComplete(db, taskId, { nodeId: "plan-1", result: planResult });

  return { taskId, planAttemptId: `att-${taskId}-plan-1-1` };
}

export function replanAcceptedModules(db: TaskcraftDatabase): {
  taskId: string;
  originalPlanAttemptId: string;
} {
  const { taskId, planAttemptId } = setupL3ToFeasibility(db);
  const feasibility = reviewStart(
    db,
    taskId,
    reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
  );
  passReview(db, taskId, feasibility.reviewAttemptId, planAttemptId);
  const childTaskIds = completeModuleChildren(db, taskId);
  run(db, taskId, { nodeId: "integrate-1" });
  runComplete(db, taskId, {
    nodeId: "integrate-1",
    result: integrateResult(db, childTaskIds, true),
  });
  const integrationReview = reviewStart(
    db,
    taskId,
    reviewInput(
      taskId,
      "review-integrate-1",
      `att-${taskId}-integrate-1-1`,
      "integration",
    ),
  );
  reviewReplan(db, taskId, {
    taskId,
    attemptId: integrationReview.reviewAttemptId,
    reviewedAttemptId: `att-${taskId}-integrate-1-1`,
    reasonCode: "contract_changed",
    finding: "The accepted module map must change",
  });
  return { taskId, originalPlanAttemptId: planAttemptId };
}
