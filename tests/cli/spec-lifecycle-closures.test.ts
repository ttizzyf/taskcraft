import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/store/database.js";
import {
  getLifecycleSpecBindings,
  getSpecImpactResults,
} from "../../src/store/query.js";
import { runCli, withInitializedDirectory } from "./helpers.js";
import {
  L3_EXECUTE_RESULT,
  L3_SINGLE_PLAN_RESULT,
  REVIEW_EVIDENCE,
  feasibilityReviewStart,
  finishRecord,
  reviewPass,
  reviewStart,
  showJson,
  toPlanPoint,
} from "./l3-helpers.js";

describe("tc task Spec lifecycle closures", () => {
  it("runs a public L2 closure with exact Specs and a domain candidate Impact", () => {
    withInitializedDirectory((cwd) => {
      writeRegistry(cwd);
      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "L2 bound closure",
            "--level",
            "2",
            "--reason",
            "reviewed contract",
            "--specs",
            '[{"id":"engineering.core","duty":"required"}]',
          ],
          cwd,
        ).status,
      ).toBe(0);
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
            JSON.stringify({
              objective: "Deliver the reviewed contract",
              scope: { modules: ["core"] },
              acceptance: ["The delivery is reviewed"],
              specBindings: [{ id: "engineering.core", duty: "required" }],
            }),
          ],
          cwd,
        ).status,
      ).toBe(0);
      expect(runCli(["run", "T-1", "--node", "execute-1"], cwd).status).toBe(0);
      expect(
        runCli(
          [
            "run",
            "complete",
            "T-1",
            "--result",
            JSON.stringify({
              summary: "Delivered",
              evidence: [
                {
                  type: "validation",
                  reference: "ref://l2-validation",
                  summary: "Validated",
                },
              ],
            }),
          ],
          cwd,
        ).status,
      ).toBe(0);
      const review = runCli(
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
        ],
        cwd,
      );
      expect(review.status).toBe(0);
      expect(review.stdout).toContain("engineering.core");
      expect(review.stdout).toContain("Reviewed attempt:");
      expect(
        runCli(
          [
            "review",
            "pass",
            "T-1",
            "--attempt",
            "att-T-1-review-1-1",
            "--reviewed-attempt",
            "att-T-1-execute-1-1",
            "--evidence",
            REVIEW_EVIDENCE,
          ],
          cwd,
        ).status,
      ).toBe(0);
      expect(runCli(["run", "T-1", "--node", "record-1"], cwd).status).toBe(0);
      const recorded = runCli(
        [
          "run",
          "complete",
          "T-1",
          "--node",
          "record-1",
          "--result",
          JSON.stringify({
            summary: "Recorded",
            specImpact: {
              outcome: "candidate",
              candidates: [
                {
                  kind: "domain",
                  title: "Owner approval",
                  rule: "Business rules require owner confirmation",
                  reason: "Code is not domain authority",
                  ownerDecision: "Product owner must accept or reject",
                },
              ],
            },
          }),
        ],
        cwd,
      );
      expect(recorded.status).toBe(0);
      expect(recorded.stdout).toContain("Status: done");

      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      expect(getLifecycleSpecBindings(database, "T-1", 1)).toHaveLength(4);
      expect(getSpecImpactResults(database, "T-1")[0]).toMatchObject({
        outcome: "candidate",
      });
      database.close();
    });
  });

  it("runs a public L3 single closure with accepted execution Specs", () => {
    withInitializedDirectory((cwd) => {
      writeRegistry(cwd);
      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "L3 single bound",
            "--level",
            "3",
            "--reason",
            "atomic migration",
            "--specs",
            '[{"id":"engineering.core","duty":"required"}]',
          ],
          cwd,
        ).status,
      ).toBe(0);
      const plan = JSON.parse(L3_SINGLE_PLAN_RESULT) as {
        executionSpecs: unknown[];
      };
      plan.executionSpecs = [{ id: "engineering.core", duty: "required" }];
      const planAttempt = toPlanPoint(cwd, JSON.stringify(plan));
      const feasibility = feasibilityReviewStart(cwd, planAttempt);
      reviewPass(cwd, feasibility, planAttempt);

      expect(showJson(cwd).children).toEqual([]);
      const execute = runCli(["run", "T-1", "--node", "execute-1"], cwd);
      expect(execute.status).toBe(0);
      expect(execute.stdout).toContain("engineering.core");
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
});

function writeRegistry(cwd: string): void {
  mkdirSync(join(cwd, "docs"), { recursive: true });
  writeFileSync(join(cwd, "docs", "core.md"), "# Core\n", "utf8");
  writeFileSync(
    join(cwd, ".taskcraft", "spec", "index.json"),
    JSON.stringify({
      schemaVersion: "tc-spec-registry/v1",
      specs: [
        {
          id: "engineering.core",
          kind: "engineering",
          path: "docs/core.md",
          summary: "Core contract",
          appliesTo: ["src/**"],
          status: "active",
        },
      ],
    }),
    "utf8",
  );
}
