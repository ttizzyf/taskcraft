// L2 review CLI integration tests: spawn dist/cli.js in an isolated temp
// directory and drive the three review feedback loops to done (passed /
// changes_requested / replan_required), asserting the projected next
// commands and the queryable history on every path.

import { describe, expect, it } from "vitest";

import { runCli, withInitializedDirectory } from "./helpers.js";
import {
  EXECUTE_RESULT,
  finishRecord,
  newL2Task,
  reviewPass,
  reviewStart,
  showJson,
  toReviewPoint,
} from "./review-helpers.js";

describe("tc review start", () => {
  it("projects the review pass command and renders the disclosure", () => {
    withInitializedDirectory((cwd) => {
      newL2Task(cwd);
      const reviewed = toReviewPoint(cwd);

      const next = runCli(["task", "next", "T-1"], cwd);
      expect(next.stdout).toContain(
        "Next: tc review start T-1 --node review-1 --purpose delivery --reviewed-attempt att-T-1-execute-1-1",
      );

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
          reviewed,
          "--host",
          "claude",
        ],
        cwd,
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Review attempt: att-T-1-review-1-1");
      expect(result.stdout).toContain("Reviewed attempt: att-T-1-execute-1-1");
      expect(result.stdout).toContain("Purpose: delivery");
      expect(result.stdout).toContain("Capability: context-only");
      expect(result.stdout).toContain("Independence: unverified");
      expect(result.stdout).toContain(
        "Next: tc review pass T-1 --attempt att-T-1-review-1-1 --reviewed-attempt att-T-1-execute-1-1",
      );
    });
  });

  it("rejects an inconsistent independence disclosure with exit 1", () => {
    withInitializedDirectory((cwd) => {
      newL2Task(cwd);
      toReviewPoint(cwd);
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
          "att-T-1-execute-1-1",
          "--independence",
          "observed-distinct",
        ],
        cwd,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("TC_REVIEW_INDEPENDENCE_INVALID");
      expect(result.stderr).toContain("impact:");
      expect(result.stderr).toContain("remediation:");
    });
  });
});

describe("review feedback loops", () => {
  it("runs the L2 passed loop to done", () => {
    withInitializedDirectory((cwd) => {
      newL2Task(cwd);
      const reviewed = toReviewPoint(cwd);
      const reviewAttempt = reviewStart(cwd, reviewed);

      reviewPass(cwd, reviewAttempt, reviewed);
      const status = runCli(["status"], cwd);
      expect(status.stdout).toContain("Next: tc run T-1 --node record-1");
      expect(status.stdout).toContain("review-1  satisfied");

      finishRecord(cwd);

      const data = showJson(cwd);
      expect(data.status).toBe("done");
      expect(data.attempts).toHaveLength(4);
      expect(data.attempts).toContainEqual(
        expect.objectContaining({
          id: "att-T-1-review-1-1",
          status: "finished",
          outcome: "passed",
        }),
      );
      expect(data.evidence).toHaveLength(5);
      expect(data.findings).toEqual([]);
    });
  });

  it("runs the changes_requested loop: successor execute, re-review, done", () => {
    withInitializedDirectory((cwd) => {
      newL2Task(cwd);
      const reviewed = toReviewPoint(cwd);
      const reviewAttempt = reviewStart(cwd, reviewed);

      const changes = runCli(
        [
          "review",
          "changes",
          "T-1",
          "--attempt",
          reviewAttempt,
          "--finding",
          "Missing boundary test",
        ],
        cwd,
      );
      expect(changes.status).toBe(0);
      expect(changes.stdout).toContain("Outcome: changes_requested");
      expect(changes.stdout).toContain(
        "Finding: fnd-T-1-1: Missing boundary test",
      );
      expect(changes.stdout).toContain(
        "Successor attempt: att-T-1-execute-1-2",
      );
      expect(changes.stdout).toContain("Next: tc run complete T-1");

      const redo = runCli(
        ["run", "complete", "T-1", "--result", EXECUTE_RESULT],
        cwd,
      );
      expect(redo.status).toBe(0);
      expect(redo.stdout).toContain(
        "Next: tc review start T-1 --node review-1 --purpose delivery --reviewed-attempt att-T-1-execute-1-2",
      );

      const secondReview = reviewStart(cwd, "att-T-1-execute-1-2");
      reviewPass(cwd, secondReview, "att-T-1-execute-1-2");
      finishRecord(cwd);

      const data = showJson(cwd);
      expect(data.status).toBe("done");
      expect(data.attempts).toContainEqual(
        expect.objectContaining({
          id: "att-T-1-execute-1-1",
          status: "finished",
          outcome: "success",
        }),
      );
      expect(data.attempts).toContainEqual(
        expect.objectContaining({
          id: "att-T-1-execute-1-2",
          status: "finished",
          outcome: "success",
        }),
      );
      expect(data.findings).toEqual([
        expect.objectContaining({
          id: "fnd-T-1-1",
          severity: "blocking",
          summary: "Missing boundary test",
        }),
      ]);
    });
  });

  it("runs the replan_required loop: new revision, rework, done, history visible", () => {
    withInitializedDirectory((cwd) => {
      newL2Task(cwd);
      const reviewed = toReviewPoint(cwd);
      const reviewAttempt = reviewStart(cwd, reviewed);

      const replan = runCli(
        [
          "review",
          "replan",
          "T-1",
          "--attempt",
          reviewAttempt,
          "--reason",
          "scope_changed",
          "--finding",
          "Contract changed",
        ],
        cwd,
      );
      expect(replan.status).toBe(0);
      expect(replan.stdout).toContain("Outcome: replan_required");
      expect(replan.stdout).toContain("New revision: 2");
      expect(replan.stdout).toContain("Next: tc run T-1 --node frame-1");
      expect(showJson(cwd).attempts).toContainEqual(
        expect.objectContaining({
          id: "att-T-1-execute-1-1",
          lifecycleRevision: 1,
          status: "finished",
          outcome: "success",
        }),
      );

      const reviewedAgain = toReviewPoint(cwd);
      expect(reviewedAgain).toBe("att-T-1-execute-1-2");
      const secondReview = reviewStart(cwd, reviewedAgain);
      expect(secondReview).toBe("att-T-1-review-1-2");
      reviewPass(cwd, secondReview, reviewedAgain);
      finishRecord(cwd);

      const data = showJson(cwd);
      expect(data.status).toBe("done");
      expect(data.lifecycleRevision).toBe(2);
      expect(data.attempts).toContainEqual(
        expect.objectContaining({
          id: "att-T-1-frame-1-1",
          lifecycleRevision: 1,
          status: "finished",
          outcome: "success",
        }),
      );
      expect(data.attempts).toContainEqual(
        expect.objectContaining({
          id: "att-T-1-review-1-1",
          lifecycleRevision: 1,
          status: "superseded",
          outcome: "superseded",
        }),
      );
      expect(data.attempts).toContainEqual(
        expect.objectContaining({
          id: "att-T-1-frame-1-2",
          lifecycleRevision: 2,
          status: "finished",
          outcome: "success",
        }),
      );
      expect(data.findings).toEqual([
        expect.objectContaining({
          id: "fnd-T-1-1",
          severity: "blocking",
          summary: "Contract changed",
        }),
      ]);
    });
  });
});
