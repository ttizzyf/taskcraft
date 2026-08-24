// Public CLI helpers for the v2 L3 flow: planning review atomically creates
// two real children, each child closes independently, then the parent
// integrates exact child revisions and evidence.

import { expect } from "vitest";

import { runCli } from "./helpers.js";

export const L3_FRAME_RESULT = JSON.stringify({
  objective: "Migrate the auth contract",
  scope: ["core", "cli"],
  acceptanceAnchors: [
    { id: "A-01", text: "The storage child closes independently" },
    { id: "A-02", text: "The projection child waits for storage" },
  ],
  nonGoals: ["Taskcraft does not schedule subagents"],
});

export const L3_PLAN_RESULT = JSON.stringify({
  decomposition: {
    mode: "modules",
    reason: "Storage and projection are independently reviewable",
    attemptedSplits: [],
  },
  modules: [
    {
      key: "contract",
      title: "Auth contract storage",
      level: 2,
      reason: "Storage needs a delivery review",
      objective: "Persist the auth contract",
      scope: ["migrations", "store"],
      acceptance: ["The auth contract is persisted"],
      nonGoals: ["No UI"],
      covers: ["A-01"],
      reviewFocus: ["foreign keys"],
      specBindings: [],
    },
    {
      key: "projection",
      title: "Auth contract projection",
      level: 1,
      reason: "Projection is independently testable",
      objective: "Project the auth contract",
      scope: ["projector"],
      acceptance: ["The projection reads the contract"],
      nonGoals: ["No scheduling"],
      covers: ["A-02"],
      reviewFocus: ["status precedence"],
      specBindings: [],
    },
  ],
  coverage: [
    { anchorId: "A-01", disposition: "required", moduleKeys: ["contract"] },
    { anchorId: "A-02", disposition: "required", moduleKeys: ["projection"] },
  ],
  dependencies: [{ task: "projection", dependsOn: "contract" }],
  executionMode: "serial",
  sharedValidations: [
    { id: "full-check", reference: "pnpm check", owner: "parent-integrate" },
  ],
  integrationPath: "integrate://deliverables",
  executionSpecs: [],
});

export const L3_SINGLE_PLAN_RESULT = JSON.stringify({
  decomposition: {
    mode: "single",
    reason: "The migration is one atomic cutover",
    attemptedSplits: [
      {
        proposal: "Separate migration and verification",
        failureReason: "Verification is part of the same atomic cutover",
      },
    ],
  },
  modules: [],
  coverage: [
    { anchorId: "A-01", disposition: "required", moduleKeys: [] },
    { anchorId: "A-02", disposition: "required", moduleKeys: [] },
  ],
  dependencies: [],
  executionMode: "serial",
  sharedValidations: [
    { id: "full-check", reference: "pnpm check", owner: "parent-integrate" },
  ],
  integrationPath: "integrate://single",
  executionSpecs: [],
});

export const L3_EXECUTE_RESULT = JSON.stringify({
  summary: "Module delivered",
  evidence: [
    { type: "validation", reference: "ref://validation", summary: "Validated" },
    { type: "test", reference: "ref://test", summary: "Tests pass" },
  ],
});

export const L3_INTEGRATE_RESULT = true;
export const L3_INTEGRATE_RESULT_PLAIN = false;

export const REVIEW_EVIDENCE = JSON.stringify([
  {
    type: "validation",
    reference: "ref://review",
    summary: "Reviewer verified the attempt",
  },
]);
export const RECORD_RESULT = JSON.stringify({
  summary: "Recorded",
  specImpact: { outcome: "none", reason: "No reusable rule changed" },
});

export interface AttemptJson {
  id: string;
  lifecycleRevision: number;
  nodeId: string;
  status: string;
  outcome: string | null;
}

export interface FactJson {
  id: string;
  category: string;
  subject: string;
  value: unknown;
  sourceAttemptId: string;
  supersedesFactId: string | null;
}

export interface ShowData {
  status: string;
  taskRevision: number;
  lifecycleRevision: number;
  next: string | null;
  attempts: AttemptJson[];
  facts: FactJson[];
  evidence: Array<{ id: string }>;
  findings: unknown[];
  children: Array<{ taskId: string; status: string }>;
}

export function newL3Task(cwd: string): void {
  const created = runCli(
    [
      "task",
      "new",
      "--title",
      "Migrate auth contract",
      "--level",
      "3",
      "--reason",
      "Schema migration and integration acceptance",
    ],
    cwd,
  );
  expect(created.status).toBe(0);
  expect(created.stdout).toContain("Next: tc run T-1 --node frame-1");
}

export function toPlanPoint(cwd: string, planResult = L3_PLAN_RESULT): string {
  expect(runCli(["run", "T-1", "--node", "frame-1"], cwd).status).toBe(0);
  expect(
    runCli(
      [
        "run",
        "complete",
        "T-1",
        "--node",
        "frame-1",
        "--result",
        L3_FRAME_RESULT,
      ],
      cwd,
    ).status,
  ).toBe(0);
  const plan = runCli(["run", "T-1", "--node", "plan-1"], cwd);
  expect(plan.status).toBe(0);
  const attemptId = /Attempt: (\S+)/.exec(plan.stdout)?.[1];
  expect(attemptId).toBeDefined();
  expect(
    runCli(
      ["run", "complete", "T-1", "--node", "plan-1", "--result", planResult],
      cwd,
    ).status,
  ).toBe(0);
  return attemptId!;
}

export function feasibilityReviewStart(
  cwd: string,
  planAttemptId: string,
): string {
  return reviewStart(cwd, "review-plan-1", "feasibility", planAttemptId);
}

export function reviewStart(
  cwd: string,
  nodeId: string,
  purpose: "feasibility" | "delivery" | "integration",
  reviewedAttemptId: string,
  taskId = "T-1",
): string {
  const result = runCli(
    [
      "review",
      "start",
      taskId,
      "--node",
      nodeId,
      "--purpose",
      purpose,
      "--reviewed-attempt",
      reviewedAttemptId,
    ],
    cwd,
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const attemptId = /Review attempt: (\S+)/.exec(result.stdout)?.[1];
  expect(attemptId).toBeDefined();
  return attemptId!;
}

export function reviewPass(
  cwd: string,
  reviewAttemptId: string,
  reviewedAttemptId: string,
  taskId = "T-1",
): void {
  const result = runCli(
    [
      "review",
      "pass",
      taskId,
      "--attempt",
      reviewAttemptId,
      "--reviewed-attempt",
      reviewedAttemptId,
      "--evidence",
      REVIEW_EVIDENCE,
    ],
    cwd,
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Outcome: passed");
}

/** Completes T-2 (L2 child) and T-3 (L1 child) through public commands. */
export function toDeliveryPoint(cwd: string): string[] {
  expect(runCli(["run", "T-2", "--node", "execute-1"], cwd).status).toBe(0);
  expect(
    runCli(["run", "complete", "T-2", "--result", L3_EXECUTE_RESULT], cwd)
      .status,
  ).toBe(0);
  const review = reviewStart(
    cwd,
    "review-1",
    "delivery",
    "att-T-2-execute-1-1",
    "T-2",
  );
  reviewPass(cwd, review, "att-T-2-execute-1-1", "T-2");
  finishRecord(cwd, "T-2");

  expect(runCli(["run", "T-3", "--node", "execute-1"], cwd).status).toBe(0);
  const l1Result = JSON.stringify({
    ...JSON.parse(L3_EXECUTE_RESULT),
    record: {
      summary: "L1 child recorded",
      specImpact: { outcome: "none", reason: "No reusable rule changed" },
    },
  });
  expect(
    runCli(["run", "complete", "T-3", "--result", l1Result], cwd).status,
  ).toBe(0);
  return ["T-2", "T-3"];
}

export function toIntegratePoint(cwd: string, modified: boolean): string {
  const childrenResults = ["T-2", "T-3"].map((taskId) => {
    const child = showJson(cwd, taskId);
    return {
      taskId,
      taskRevision: child.taskRevision,
      evidenceRefs: [child.evidence[0]!.id],
    };
  });
  const result = JSON.stringify({
    childrenResults,
    integrationEvidence: modified
      ? [
          {
            type: "test",
            reference: "ref://integration",
            summary: "Integration passes",
          },
        ]
      : [],
    modifiedDeliverables: modified,
  });
  expect(runCli(["run", "T-1", "--node", "integrate-1"], cwd).status).toBe(0);
  expect(
    runCli(
      ["run", "complete", "T-1", "--node", "integrate-1", "--result", result],
      cwd,
    ).status,
  ).toBe(0);
  return "att-T-1-integrate-1-1";
}

export function finishRecord(cwd: string, taskId = "T-1"): void {
  expect(runCli(["run", taskId, "--node", "record-1"], cwd).status).toBe(0);
  const done = runCli(
    [
      "run",
      "complete",
      taskId,
      "--node",
      "record-1",
      "--result",
      RECORD_RESULT,
    ],
    cwd,
  );
  expect(done.status).toBe(0);
  expect(done.stdout).toContain("Status: done");
}

export function showJson(cwd: string, taskId = "T-1"): ShowData {
  return JSON.parse(runCli(["task", "show", taskId, "--json"], cwd).stdout)
    .data as ShowData;
}
