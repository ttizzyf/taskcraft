// Shared fixtures and command helpers for the review CLI test files: drive
// an L2 task to the review point, run review start/pass and finish the
// record node in the isolated temp directory.

import { expect } from "vitest";

import { runCli } from "./helpers.js";

export const FRAME_RESULT = JSON.stringify({
  objective: "Frame the retry policy",
  scope: { modules: ["core"] },
  acceptance: ["Retry policy is configurable per adapter"],
});

export const EXECUTE_RESULT = JSON.stringify({
  summary: "Retry policy implemented",
  evidence: [
    { type: "validation", reference: "ref://validation", summary: "Validated" },
    { type: "test", reference: "ref://test", summary: "Tests pass" },
  ],
});

export const REVIEW_EVIDENCE = JSON.stringify([
  {
    type: "validation",
    reference: "ref://review-diff",
    summary: "Reviewer verified the diff and ran the boundary test",
  },
]);

export const RECORD_RESULT = JSON.stringify({ summary: "Recorded" });

export interface AttemptJson {
  id: string;
  lifecycleRevision: number;
  status: string;
  outcome: string | null;
}

export interface FindingJson {
  id: string;
  severity: string;
  summary: string;
}

export interface ShowData {
  status: string;
  lifecycleRevision: number;
  attempts: AttemptJson[];
  evidence: unknown[];
  findings: FindingJson[];
}

export function newL2Task(cwd: string): void {
  const created = runCli(
    ["task", "new", "--title", "L2 review", "--level", "2", "--reason", "r"],
    cwd,
  );
  expect(created.status).toBe(0);
  expect(created.stdout).toContain("Next: tc run T-1 --node frame-1");
}

/** Drives the L2 task to the review point (frame and execute finished) and
 * returns the execute attempt id of the current revision (attempt numbers
 * advance per node across revisions, so it is read from the Node Brief). */
export function toReviewPoint(cwd: string): string {
  expect(runCli(["run", "T-1", "--node", "frame-1"], cwd).status).toBe(0);
  expect(
    runCli(
      ["run", "complete", "T-1", "--node", "frame-1", "--result", FRAME_RESULT],
      cwd,
    ).status,
  ).toBe(0);
  const execute = runCli(["run", "T-1", "--node", "execute-1"], cwd);
  expect(execute.status).toBe(0);
  const match = /Attempt: (\S+)/.exec(execute.stdout);
  expect(match).not.toBeNull();
  expect(
    runCli(["run", "complete", "T-1", "--result", EXECUTE_RESULT], cwd).status,
  ).toBe(0);

  return match![1]!;
}

/** Starts the review and returns the review attempt id from the output. */
export function reviewStart(cwd: string, reviewedAttemptId: string): string {
  const result = runCli(
    [
      "review",
      "start",
      "T-1",
      "--node",
      "review-1",
      "--purpose",
      "delivery",
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
