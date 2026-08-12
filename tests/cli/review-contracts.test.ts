// Review CLI contract tests: exit codes with stable errors, --json same
// source rendering, the --expected-revision CAS guard and evidence input
// from an @path file.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseJson, runCli, withInitializedDirectory } from "./helpers.js";
import {
  newL2Task,
  REVIEW_EVIDENCE,
  reviewStart,
  toReviewPoint,
} from "./review-helpers.js";

describe("review failure and output contracts", () => {
  it("fails business errors with exit 1 and stable errors", () => {
    withInitializedDirectory((cwd) => {
      newL2Task(cwd);
      toReviewPoint(cwd);

      const unknown = runCli(
        [
          "review",
          "start",
          "T-99",
          "--node",
          "review-1",
          "--purpose",
          "delivery",
          "--reviewed-attempt",
          "x",
        ],
        cwd,
      );
      expect(unknown.status).toBe(1);
      expect(unknown.stderr).toContain("TC_TASK_NOT_FOUND");

      expect(runCli(["review", "start", "T-1"], cwd).status).toBe(1);

      const reviewAttempt = reviewStart(cwd, "att-T-1-execute-1-1");
      const missingEvidence = runCli(
        [
          "review",
          "pass",
          "T-1",
          "--attempt",
          reviewAttempt,
          "--reviewed-attempt",
          "att-T-1-execute-1-1",
          "--evidence",
          "[]",
        ],
        cwd,
      );
      expect(missingEvidence.status).toBe(1);
      expect(missingEvidence.stderr).toContain("TC_REQUIRED_EVIDENCE_MISSING");

      const badReason = runCli(
        [
          "review",
          "replan",
          "T-1",
          "--attempt",
          reviewAttempt,
          "--reason",
          "bogus",
          "--finding",
          "x",
        ],
        cwd,
      );
      expect(badReason.status).toBe(1);
      expect(badReason.stderr).toContain("TC_TASK_INPUT_INVALID");
    });
  });

  it("keeps --json output same-source with the text fields", () => {
    withInitializedDirectory((cwd) => {
      newL2Task(cwd);
      const reviewed = toReviewPoint(cwd);

      const json = parseJson<{
        ok: boolean;
        data: {
          next: string;
          reviewAttemptId: string;
          reviewedAttemptId: string;
          purpose: string;
        };
      }>(
        runCli(
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
            "--json",
          ],
          cwd,
        ),
      );
      expect(json.ok).toBe(true);
      expect(json.data.reviewAttemptId).toBe("att-T-1-review-1-1");
      expect(json.data.reviewedAttemptId).toBe("att-T-1-execute-1-1");
      expect(json.data.purpose).toBe("delivery");

      const text = runCli(["status"], cwd).stdout;
      expect(text).toContain(`Next: ${json.data.next}`);
    });
  });

  it("rejects a stale --expected-revision with TC_REVISION_CONFLICT", () => {
    withInitializedDirectory((cwd) => {
      newL2Task(cwd);
      const reviewed = toReviewPoint(cwd);
      const reviewAttempt = reviewStart(cwd, reviewed);

      const result = runCli(
        [
          "review",
          "pass",
          "T-1",
          "--attempt",
          reviewAttempt,
          "--reviewed-attempt",
          reviewed,
          "--evidence",
          REVIEW_EVIDENCE,
          "--expected-revision",
          "1",
        ],
        cwd,
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_REVISION_CONFLICT");
      expect(result.stderr).toContain("tc status --json");
    });
  });

  it("accepts review evidence from an @path file", () => {
    withInitializedDirectory((cwd) => {
      newL2Task(cwd);
      const reviewed = toReviewPoint(cwd);
      const reviewAttempt = reviewStart(cwd, reviewed);
      writeFileSync(join(cwd, "review.json"), REVIEW_EVIDENCE);

      const passed = runCli(
        [
          "review",
          "pass",
          "T-1",
          "--attempt",
          reviewAttempt,
          "--reviewed-attempt",
          reviewed,
          "--evidence",
          "@review.json",
        ],
        cwd,
      );

      expect(passed.status).toBe(0);
      expect(passed.stdout).toContain("Outcome: passed");
    });
  });
});
