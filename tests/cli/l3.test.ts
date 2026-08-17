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
  L3_SINGLE_PLAN_RESULT,
  L3_EXECUTE_RESULT,
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
  it("runs a justified single L3 without creating a wrapper child", () => {
    withInitializedDirectory((cwd) => {
      newL3Task(cwd);
      const planAttempt = toPlanPoint(cwd, L3_SINGLE_PLAN_RESULT);
      const review = feasibilityReviewStart(cwd, planAttempt);
      reviewPass(cwd, review, planAttempt);

      expect(showJson(cwd).children).toEqual([]);
      expect(showJson(cwd).next).toBe("tc run T-1 --node execute-1");
      expect(runCli(["run", "T-1", "--node", "execute-1"], cwd).status).toBe(0);
      expect(
        runCli(["run", "complete", "T-1", "--result", L3_EXECUTE_RESULT], cwd)
          .status,
      ).toBe(0);
      const delivery = reviewStart(
        cwd,
        "review-execute-1",
        "delivery",
        "att-T-1-execute-1-1",
      );
      reviewPass(cwd, delivery, "att-T-1-execute-1-1");
      expect(runCli(["run", "T-1", "--node", "integrate-1"], cwd).status).toBe(
        0,
      );
      expect(
        runCli(
          [
            "run",
            "complete",
            "T-1",
            "--node",
            "integrate-1",
            "--result",
            JSON.stringify({
              childrenResults: [],
              integrationEvidence: [],
              modifiedDeliverables: false,
            }),
          ],
          cwd,
        ).status,
      ).toBe(0);
      finishRecord(cwd);
      expect(showJson(cwd).status).toBe("done");
    });
  });

  it("drives the main loop to done with the on-demand integration review", () => {
    withInitializedDirectory((cwd) => {
      newL3Task(cwd);
      const planAttempt = toPlanPoint(cwd);

      // Feasibility gate: children do not exist before the review passes.
      const next = runCli(["task", "next", "T-1"], cwd);
      expect(next.stdout).toContain(
        "Next: tc review start T-1 --node review-plan-1 --purpose feasibility --reviewed-attempt att-T-1-plan-1-1",
      );
      expect(next.stdout).toContain("review-plan-1  runnable");
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
      expect(opened.stdout).toContain("integrate-1  blocked");
      expect(opened.stdout).toContain("Next: tc run T-2");
      expect(opened.stdout).toContain("T-2  tc run T-2");
      const parentCard = runCli(["task", "show", "T-1"], cwd);
      expect(parentCard.stdout).toContain("Dependencies:");
      expect(parentCard.stdout).toContain("T-3  depends on  T-2");
      expect(parentCard.stdout).toContain("Shared validations:");
      expect(parentCard.stdout).toContain("owner: parent integrate");
      expect(parentCard.stdout).toContain("Execution source:");
      expect(parentCard.stdout).toContain("modules  plan: att-T-1-plan-1-1");
      const childCard = runCli(["task", "show", "T-2"], cwd);
      expect(childCard.stdout).toContain("Inherited planning:");
      expect(childCard.stdout).toContain("parent: T-1 rev 2");

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
      expect(data.attempts).toHaveLength(6);
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
      expect(showJson(cwd).attempts).toHaveLength(5);
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

      // Gate opens by materializing real children; the first child is next.
      const opened = runCli(["task", "next", "T-1"], cwd);
      expect(opened.stdout).toContain("Next: tc run T-2");
      expect(showJson(cwd).children.map((child) => child.taskId)).toEqual([
        "T-2",
        "T-3",
      ]);
      expect(showJson(cwd).findings).toEqual([
        expect.objectContaining({
          severity: "blocking",
          summary: "Plan misses boundary coverage",
        }),
      ]);
    });
  });

  it("routes an unfinished child review replan back to the L3 parent", () => {
    withInitializedDirectory((cwd) => {
      newL3Task(cwd);
      const planAttempt = toPlanPoint(cwd);
      const feasibility = feasibilityReviewStart(cwd, planAttempt);
      reviewPass(cwd, feasibility, planAttempt);
      expect(runCli(["run", "T-2", "--node", "execute-1"], cwd).status).toBe(0);
      expect(
        runCli(["run", "complete", "T-2", "--result", L3_EXECUTE_RESULT], cwd)
          .status,
      ).toBe(0);
      const delivery = reviewStart(
        cwd,
        "review-1",
        "delivery",
        "att-T-2-execute-1-1",
        "T-2",
      );

      const result = runCli(
        [
          "review",
          "replan",
          "T-2",
          "--attempt",
          delivery,
          "--reason",
          "contract_changed",
          "--finding",
          "The parent module boundary must change",
        ],
        cwd,
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Task: T-1");
      expect(result.stdout).toContain("New revision: 3");
      expect(result.stdout).toContain("Next: tc run T-1 --node frame-1");
      expect(showJson(cwd)).toMatchObject({
        lifecycleRevision: 3,
        status: "active",
        next: "tc run T-1 --node frame-1",
      });
    });
  });
});
