// L3 CLI integration tests: spawn dist/cli.js in an isolated temp directory
// and drive the full L3 loop to done (feasibility/delivery/integration
// purposes), the feasibility gate and its changes feedback loop, the
// on-demand integration review switch and the task fact add command.

import { describe, expect, it } from "vitest";

import { runCli, withInitializedDirectory } from "./helpers.js";
import {
  L3_INTEGRATE_RESULT,
  L3_INTEGRATE_RESULT_PLAIN,
  L3_PLAN_RESULT,
  feasibilityReviewStart,
  finishRecord,
  newL3Task,
  reviewPass,
  reviewStart,
  showJson,
  toDeliveryPoint,
  toIntegratePoint,
  toPlanPoint,
} from "./l3-helpers.js";

describe("L3 CLI loop", () => {
  it("drives the main loop to done with the on-demand integration review", () => {
    withInitializedDirectory((cwd) => {
      newL3Task(cwd);
      const planAttempt = toPlanPoint(cwd);

      // Feasibility gate: after plan complete, execute-1 must not be next
      // and a bare run on it must be rejected with the error triple.
      const next = runCli(["task", "next", "T-1"], cwd);
      expect(next.stdout).toContain(
        "Next: tc review start T-1 --node review-plan-1 --purpose feasibility --reviewed-attempt att-T-1-plan-1-1",
      );
      expect(next.stdout).toContain("execute-1  blocked");
      const gated = runCli(["run", "T-1", "--node", "execute-1"], cwd);
      expect(gated.status).toBe(1);
      expect(gated.stdout).toBe("");
      expect(gated.stderr).toContain("TC_ATTEMPT_REF_INVALID");
      expect(gated.stderr).toContain("impact:");
      expect(gated.stderr).toContain("remediation:");

      // Feasibility review with a probe fact discovered during review.
      const review = feasibilityReviewStart(cwd, planAttempt);
      const fact = runCli(
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
          "Auth API",
          "--value",
          '{"status":"reachable"}',
        ],
        cwd,
      );
      expect(fact.status).toBe(0);
      expect(fact.stdout).toContain("Next: tc review pass T-1");
      expect(showJson(cwd).facts).toEqual([
        expect.objectContaining({
          id: "fact-T-1-1",
          category: "probe",
          subject: "Auth API",
          sourceAttemptId: review,
        }),
      ]);

      reviewPass(cwd, review, planAttempt);
      const opened = runCli(["task", "next", "T-1"], cwd);
      expect(opened.stdout).toContain("execute-1  runnable");
      expect(opened.stdout).toContain("Next: tc run T-1 --node execute-1");

      toDeliveryPoint(cwd);
      const integrateAttempt = toIntegratePoint(cwd, L3_INTEGRATE_RESULT);

      // modifiedDeliverables: true makes the on-demand integration review
      // runnable instead of going straight to record.
      const afterIntegrate = runCli(["task", "next", "T-1"], cwd);
      expect(afterIntegrate.stdout).toContain(
        "Next: tc review start T-1 --node review-integrate-1 --purpose integration --reviewed-attempt att-T-1-integrate-1-1",
      );
      expect(afterIntegrate.stdout).toContain("record-1  blocked");

      const integrationReview = reviewStart(
        cwd,
        "review-integrate-1",
        "integration",
        integrateAttempt,
      );
      reviewPass(cwd, integrationReview, integrateAttempt);
      finishRecord(cwd);

      const data = showJson(cwd);
      expect(data.status).toBe("done");
      expect(data.next).toBeNull();
      expect(data.attempts).toHaveLength(8);
      expect(data.attempts).toContainEqual(
        expect.objectContaining({
          id: "att-T-1-review-plan-1-1",
          nodeId: "review-plan-1",
          status: "finished",
          outcome: "passed",
        }),
      );
      expect(data.attempts).toContainEqual(
        expect.objectContaining({
          id: "att-T-1-review-integrate-1-1",
          nodeId: "review-integrate-1",
          status: "finished",
          outcome: "passed",
        }),
      );
      // The probe fact stays queryable after the task is done (append-only).
      expect(data.facts).toEqual([
        expect.objectContaining({
          id: "fact-T-1-1",
          category: "probe",
          subject: "Auth API",
        }),
      ]);
    });
  });

  it("skips the integration review when integrate did not modify deliverables", () => {
    withInitializedDirectory((cwd) => {
      newL3Task(cwd);
      const planAttempt = toPlanPoint(cwd);
      const review = feasibilityReviewStart(cwd, planAttempt);
      reviewPass(cwd, review, planAttempt);
      toDeliveryPoint(cwd);
      toIntegratePoint(cwd, L3_INTEGRATE_RESULT_PLAIN);

      // Without modifiedDeliverables the integration review is bypassed and
      // next points directly at record-1.
      const next = runCli(["task", "next", "T-1"], cwd);
      expect(next.stdout).toContain("Next: tc run T-1 --node record-1");
      expect(next.stdout).toContain("review-integrate-1  blocked");

      finishRecord(cwd);
      expect(showJson(cwd).status).toBe("done");
      expect(showJson(cwd).attempts).toHaveLength(7);
    });
  });

  it("runs the feasibility changes loop: successor plan, re-review, gate opens", () => {
    withInitializedDirectory((cwd) => {
      newL3Task(cwd);
      const planAttempt = toPlanPoint(cwd);
      const review = feasibilityReviewStart(cwd, planAttempt);

      const changes = runCli(
        [
          "review",
          "changes",
          "T-1",
          "--attempt",
          review,
          "--finding",
          "Plan misses boundary coverage",
        ],
        cwd,
      );
      expect(changes.status).toBe(0);
      expect(changes.stdout).toContain("Outcome: changes_requested");
      expect(changes.stdout).toContain("Successor attempt: att-T-1-plan-1-2");
      expect(changes.stdout).toContain(
        "Next: tc run complete T-1 --node plan-1",
      );

      // Execute stays gated while the successor plan awaits its review.
      const gated = runCli(["run", "T-1", "--node", "execute-1"], cwd);
      expect(gated.status).toBe(1);
      expect(gated.stderr).toContain("TC_ATTEMPT_REF_INVALID");

      const replanned = runCli(
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
      );
      expect(replanned.stdout).toContain(
        "Next: tc review start T-1 --node review-plan-1 --purpose feasibility --reviewed-attempt att-T-1-plan-1-2",
      );

      const secondReview = feasibilityReviewStart(cwd, "att-T-1-plan-1-2");
      expect(secondReview).toBe("att-T-1-review-plan-1-2");
      reviewPass(cwd, secondReview, "att-T-1-plan-1-2");

      // Gate opens: execute-1 is runnable again.
      const opened = runCli(["task", "next", "T-1"], cwd);
      expect(opened.stdout).toContain("execute-1  runnable");
      expect(showJson(cwd).findings).toEqual([
        expect.objectContaining({
          severity: "blocking",
          summary: "Plan misses boundary coverage",
        }),
      ]);
    });
  });
});

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

      // Nothing was written by either failure.
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
      // text and JSON render the same source: the second execution is one
      // revision ahead of the first (each fact add bumps the revision).
      expect(text).toContain(`Task: ${json.data.taskId}`);
      expect(text).toContain(`Next: ${json.data.next}`);
      const textRevision = Number(/Revision: (\d+)/.exec(text)![1]);
      expect(textRevision).toBe(json.data.taskRevision + 1);
      // Append-only: the second fact is a separate row; both stay queryable.
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
