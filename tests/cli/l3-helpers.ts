// Shared fixtures and command helpers for the L3 CLI test file: drive an
// L3 task through the loop (frame -> plan -> feasibility review -> execute
// -> delivery review -> integrate -> on-demand integration review ->
// record) in the isolated temp directory. Every helper asserts the step it
// drives so the test file only asserts loop semantics.

import { expect } from "vitest";

import { runCli } from "./helpers.js";

export const L3_FRAME_RESULT = JSON.stringify({
  objective: "Migrate the auth contract",
  scope: { modules: ["core"] },
  acceptance: ["Auth contract migrated"],
});

export const L3_PLAN_RESULT = JSON.stringify({
  objectiveCoverage: ["Objective covered by the single child"],
  children: [{ id: "A", title: "Child A" }],
  dependencies: [{ name: "api-availability" }],
  validationOwners: [{ childId: "A", owner: "reviewer" }],
  integrationPath: "integrate://deliverables",
});

export const L3_EXECUTE_RESULT = JSON.stringify({
  summary: "Child A delivered",
  evidence: [
    { type: "validation", reference: "ref://validation", summary: "Validated" },
    { type: "test", reference: "ref://test", summary: "Tests pass" },
  ],
});

/** Integrate result that modified deliverables: the on-demand integration
 * review node must be projected runnable after this result. */
export const L3_INTEGRATE_RESULT = JSON.stringify({
  childrenResults: [{ childId: "A", status: "passed" }],
  integrationEvidence: [
    {
      type: "test",
      reference: "ref://integration",
      summary: "Integration passes",
    },
  ],
  modifiedDeliverables: true,
});

/** Integrate result without modifiedDeliverables: the integration review is
 * skipped and next points directly at record-1. */
export const L3_INTEGRATE_RESULT_PLAIN = JSON.stringify({
  childrenResults: [{ childId: "A", status: "passed" }],
  integrationEvidence: [],
});

export const REVIEW_EVIDENCE = JSON.stringify([
  {
    type: "validation",
    reference: "ref://review",
    summary: "Reviewer verified the attempt",
  },
]);

export const RECORD_RESULT = JSON.stringify({ summary: "Recorded" });

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
  evidence: unknown[];
  findings: unknown[];
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

/** frame + plan complete; returns the plan attempt id of the current
 * revision (read from the Node Brief). */
export function toPlanPoint(cwd: string): string {
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
  const match = /Attempt: (\S+)/.exec(plan.stdout);
  expect(match).not.toBeNull();
  expect(
    runCli(
      [
        "run",
        "complete",
        "T-1",
        "--node",
        "plan-1",
        "--result",
        L3_PLAN_RESULT,
      ],
      cwd,
    ).status,
  ).toBe(0);
  return match![1]!;
}

/** Starts the feasibility review of the plan attempt and returns the review
 * attempt id. */
export function feasibilityReviewStart(
  cwd: string,
  planAttemptId: string,
): string {
  return reviewStart(cwd, "review-plan-1", "feasibility", planAttemptId);
}

/** Starts a review on the named node with the named purpose against the
 * reviewed attempt and returns the review attempt id. */
export function reviewStart(
  cwd: string,
  nodeId: string,
  purpose: "feasibility" | "delivery" | "integration",
  reviewedAttemptId: string,
): string {
  const result = runCli(
    [
      "review",
      "start",
      "T-1",
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
  const match = /Review attempt: (\S+)/.exec(result.stdout);
  expect(match).not.toBeNull();
  return match![1]!;
}

export function reviewPass(
  cwd: string,
  reviewAttemptId: string,
  reviewedAttemptId: string,
): void {
  const result = runCli(
    [
      "review",
      "pass",
      "T-1",
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

/** execute complete + delivery review pass. */
export function toDeliveryPoint(cwd: string): void {
  expect(runCli(["run", "T-1", "--node", "execute-1"], cwd).status).toBe(0);
  const completed = runCli(
    ["run", "complete", "T-1", "--result", L3_EXECUTE_RESULT],
    cwd,
  );
  expect(completed.status).toBe(0);
  const reviewed = reviewStart(
    cwd,
    "review-execute-1",
    "delivery",
    "att-T-1-execute-1-1",
  );
  reviewPass(cwd, reviewed, "att-T-1-execute-1-1");
}

/** integrate run + complete; returns the integrate attempt id. */
export function toIntegratePoint(cwd: string, result: string): string {
  expect(runCli(["run", "T-1", "--node", "integrate-1"], cwd).status).toBe(0);
  const completed = runCli(
    ["run", "complete", "T-1", "--node", "integrate-1", "--result", result],
    cwd,
  );
  expect(completed.status).toBe(0);
  return "att-T-1-integrate-1-1";
}

export function finishRecord(cwd: string): void {
  expect(runCli(["run", "T-1", "--node", "record-1"], cwd).status).toBe(0);
  const done = runCli(
    ["run", "complete", "T-1", "--node", "record-1", "--result", RECORD_RESULT],
    cwd,
  );
  expect(done.status).toBe(0);
  expect(done.stdout).toContain("Status: done");
}

export function showJson(cwd: string): ShowData {
  return JSON.parse(runCli(["task", "show", "T-1", "--json"], cwd).stdout)
    .data as ShowData;
}
