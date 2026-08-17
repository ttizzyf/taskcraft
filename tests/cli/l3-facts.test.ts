import { describe, expect, it } from "vitest";

import { runCli, withInitializedDirectory } from "./helpers.js";
import {
  feasibilityReviewStart,
  newL3Task,
  showJson,
  toPlanPoint,
} from "./l3-helpers.js";

describe("tc task fact add", () => {
  it("rejects an invalid category and an unparsable value with exit 1", () => {
    withInitializedDirectory((cwd) => {
      newL3Task(cwd);
      const planAttempt = toPlanPoint(cwd);
      const review = feasibilityReviewStart(cwd, planAttempt);

      const badCategory = runCli(
        [
          "task",
          "fact",
          "add",
          "T-1",
          "--attempt",
          review,
          "--category",
          "gossip",
          "--subject",
          "x",
          "--value",
          "{}",
        ],
        cwd,
      );
      expect(badCategory.status).toBe(1);
      expect(badCategory.stdout).toBe("");
      expect(badCategory.stderr).toContain("TC_FACT_INPUT_INVALID");
      expect(badCategory.stderr).toContain("impact:");
      expect(badCategory.stderr).toContain("remediation:");

      const badValue = runCli(
        [
          "task",
          "fact",
          "add",
          "T-1",
          "--attempt",
          review,
          "--category",
          "probe",
          "--subject",
          "x",
          "--value",
          "{not json",
        ],
        cwd,
      );
      expect(badValue.status).toBe(1);
      expect(badValue.stderr).toContain("TC_FACT_INPUT_INVALID");
      expect(showJson(cwd).facts).toEqual([]);
    });
  });

  it("rejects an attempt of another revision with TC_ATTEMPT_REF_INVALID", () => {
    withInitializedDirectory((cwd) => {
      newL3Task(cwd);
      toPlanPoint(cwd);
      const result = runCli(
        [
          "task",
          "fact",
          "add",
          "T-1",
          "--attempt",
          "att-T-1-frame-9-1",
          "--category",
          "probe",
          "--subject",
          "x",
          "--value",
          "{}",
        ],
        cwd,
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_ATTEMPT_REF_INVALID");
    });
  });

  it("--json and text render the same source data", () => {
    withInitializedDirectory((cwd) => {
      newL3Task(cwd);
      const planAttempt = toPlanPoint(cwd);
      const review = feasibilityReviewStart(cwd, planAttempt);

      const json = JSON.parse(
        runCli(
          [
            "task",
            "fact",
            "add",
            "T-1",
            "--attempt",
            review,
            "--category",
            "dependency",
            "--subject",
            "api-availability",
            "--value",
            '{"provider":"upstream"}',
            "--json",
          ],
          cwd,
        ).stdout,
      ) as {
        ok: boolean;
        data: { taskId: string; taskRevision: number; next: string | null };
      };

      expect(json.ok).toBe(true);
      const text = runCli(
        [
          "task",
          "fact",
          "add",
          "T-1",
          "--attempt",
          review,
          "--category",
          "dependency",
          "--subject",
          "api-availability",
          "--value",
          '{"provider":"upstream"}',
        ],
        cwd,
      ).stdout;
      expect(text).toContain(`Task: ${json.data.taskId}`);
      expect(text).toContain(`Next: ${json.data.next}`);
      const textRevision = Number(/Revision: (\d+)/.exec(text)![1]);
      expect(textRevision).toBe(json.data.taskRevision + 1);
      const facts = showJson(cwd).facts;
      expect(facts).toHaveLength(2);
      expect(facts[1]).toMatchObject({
        id: "fact-T-1-2",
        category: "dependency",
        subject: "api-availability",
      });
    });
  });

  it("rejects --evidence and --supersedes references of other tasks", () => {
    withInitializedDirectory((cwd) => {
      newL3Task(cwd);
      const planAttempt = toPlanPoint(cwd);
      const review = feasibilityReviewStart(cwd, planAttempt);

      const badEvidence = runCli(
        [
          "task",
          "fact",
          "add",
          "T-1",
          "--attempt",
          review,
          "--category",
          "probe",
          "--subject",
          "x",
          "--value",
          "{}",
          "--evidence",
          "ev-other-task-1",
        ],
        cwd,
      );
      expect(badEvidence.status).toBe(1);
      expect(badEvidence.stderr).toContain("TC_EVIDENCE_REF_INVALID");

      const badSupersedes = runCli(
        [
          "task",
          "fact",
          "add",
          "T-1",
          "--attempt",
          review,
          "--category",
          "probe",
          "--subject",
          "x",
          "--value",
          "{}",
          "--supersedes",
          "fact-other-task-1",
        ],
        cwd,
      );
      expect(badSupersedes.status).toBe(1);
      expect(badSupersedes.stderr).toContain("TC_FACT_SUPERSEDE_INVALID");
    });
  });
});
