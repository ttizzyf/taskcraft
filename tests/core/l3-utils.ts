// Shared fixtures and helpers for the L3 reducer/projector test suites:
// the result documents accepted by the L3 node schemas, the review input
// builder, the review pass helper and the reducer driver up to the
// feasibility review point.

import type { TaskcraftDatabase } from "../../src/store/database.js";
import {
  reviewPass,
  run,
  runComplete,
  taskNew,
} from "../../src/core/reducer.js";

export const L3_FRAME_RESULT = {
  objective: "Ship the L3 initiative",
  scope: { modules: ["core"] },
  acceptance: ["L3 graph drives to done"],
};

export const L3_PLAN_RESULT = {
  objectiveCoverage: ["Objective covered by children A and B"],
  children: [
    { id: "A", title: "Child A" },
    { id: "B", title: "Child B" },
  ],
  dependencies: [{ name: "api-availability" }],
  validationOwners: [{ childId: "A", owner: "reviewer" }],
  integrationPath: "integrate://deliverables",
};

export const L3_EXECUTE_RESULT = {
  summary: "Both children delivered",
  evidence: [
    { type: "validation", reference: "ref://validation", summary: "Validated" },
    { type: "test", reference: "ref://test", summary: "Tests pass" },
  ],
};

export const L3_INTEGRATE_RESULT = {
  childrenResults: [
    { childId: "A", status: "passed" },
    { childId: "B", status: "passed" },
  ],
  integrationEvidence: [
    {
      type: "test",
      reference: "ref://integration",
      summary: "Integration passes",
    },
  ],
  modifiedDeliverables: true,
};

export const L3_INTEGRATE_RESULT_PLAIN = {
  childrenResults: [
    { childId: "A", status: "passed" },
    { childId: "B", status: "passed" },
  ],
  integrationEvidence: [],
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
): void {
  reviewPass(db, taskId, {
    taskId,
    attemptId: reviewAttemptId,
    reviewedAttemptId,
    evidence: [
      { type: "validation", reference: "ref://review", summary: "Reviewed" },
    ],
  });
}

/** Drives an L3 task through the reducer up to the feasibility review
 * (frame and plan finished, review-plan-1 runnable). */
export function setupL3ToFeasibility(db: TaskcraftDatabase): {
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
  runComplete(db, taskId, { nodeId: "plan-1", result: L3_PLAN_RESULT });

  return { taskId, planAttemptId: `att-${taskId}-plan-1-1` };
}
