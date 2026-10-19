import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/store/database.js";
import { getLifecycleSpecBindings } from "../../src/store/query.js";
import { runCli, withInitializedDirectory } from "./helpers.js";
import {
  L3_FRAME_RESULT,
  L3_PLAN_RESULT,
  REVIEW_EVIDENCE,
  finishRecord,
  showJson,
  toDeliveryPoint,
  toIntegratePoint,
} from "./l3-helpers.js";

describe("tc task Spec lifecycle", () => {
  it("starts Execute after the bound document changes and rebinds on refresh", () => {
    withInitializedDirectory((cwd) => {
      writeRegistry(cwd);
      const created = runCli(
        [
          "task",
          "new",
          "--title",
          "Bound task",
          "--level",
          "1",
          "--reason",
          "confirmed contract",
          "--specs",
          '[{"id":"engineering.core","duty":"required"}]',
        ],
        cwd,
      );
      expect(created.status).toBe(0);
      writeFileSync(join(cwd, "docs", "core.md"), "# Core changed\n", "utf8");

      // The binding records which document the task adopted. Editing that
      // document afterwards does not gate the task's own work.
      const started = runCli(["run", "T-1"], cwd);
      expect(started.status).toBe(0);
      expect(started.stdout).toContain("Attempt: att-T-1-execute-1-1");

      const refresh = runCli(
        [
          "task",
          "spec",
          "refresh",
          "T-1",
          "--reason",
          "Core contract changed",
          "--expected-revision",
          "2",
        ],
        cwd,
      );
      expect(refresh.status).toBe(0);
      expect(refresh.stdout).toContain("Revision: 3");

      const refreshedDatabase = openDatabase(
        join(cwd, ".taskcraft", "taskcraft.db"),
      );
      expect(
        getLifecycleSpecBindings(refreshedDatabase, "T-1", 2).every(
          (binding) => binding.sourceKind === "refresh",
        ),
      ).toBe(true);
      refreshedDatabase.close();
    });
  });

  it("starts work without reading the Registry at all", () => {
    for (const damage of ["missing-document", "invalid-registry"] as const) {
      withInitializedDirectory((cwd) => {
        writeRegistry(cwd);
        expect(
          runCli(
            [
              "task",
              "new",
              "--title",
              "Required",
              "--level",
              "1",
              "--reason",
              "required contract",
              "--specs",
              '[{"id":"engineering.core","duty":"required"}]',
            ],
            cwd,
          ).status,
        ).toBe(0);

        if (damage === "missing-document") {
          unlinkSync(join(cwd, "docs", "core.md"));
        } else {
          writeFileSync(
            join(cwd, ".taskcraft", "spec", "index.json"),
            "not-json",
            "utf8",
          );
        }

        // The command boundary resolves Specs when a binding is created, never
        // when an attempt is claimed, so a broken Registry cannot stop work.
        const started = runCli(["run", "T-1"], cwd);
        expect(started.status).toBe(0);
        expect(started.stdout).toContain("Attempt: att-T-1-execute-1-1");
      });
    }
  });

  it("opens a delivery Review and accepts changes after the document changes", () => {
    withInitializedDirectory((cwd) => {
      writeRegistry(cwd);
      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "Reviewed",
            "--level",
            "2",
            "--reason",
            "delivery review",
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
              objective: "Reviewed delivery",
              scope: {},
              acceptance: ["Reviewed"],
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
                  reference: "ref://validation",
                  summary: "Validated",
                },
              ],
            }),
          ],
          cwd,
        ).status,
      ).toBe(0);
      writeFileSync(join(cwd, "docs", "core.md"), "# Review changed\n", "utf8");

      const opened = runCli(
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
      expect(opened.status).toBe(0);
      expect(opened.stdout).toContain("engineering.core");

      // Requesting changes creates a successor Execute attempt. Nothing about
      // the Spec documents can refuse it: the reviewer decides.
      const changed = runCli(
        [
          "review",
          "changes",
          "T-1",
          "--attempt",
          "att-T-1-review-1-1",
          "--finding",
          "Correct the delivery",
        ],
        cwd,
      );
      expect(changed.status).toBe(0);
    });
  });

  it("resolves and atomically writes public L3 Plan bindings", () => {
    withInitializedDirectory((cwd) => {
      writeRegistry(cwd);
      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "L3 bound",
            "--level",
            "3",
            "--reason",
            "module Specs",
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
            L3_FRAME_RESULT,
          ],
          cwd,
        ).status,
      ).toBe(0);
      expect(runCli(["run", "T-1", "--node", "plan-1"], cwd).status).toBe(0);
      const plan = JSON.parse(L3_PLAN_RESULT) as {
        executionSpecs: unknown[];
        modules: Array<{ specBindings: unknown[] }>;
      };
      plan.executionSpecs = [{ id: "engineering.core", duty: "required" }];
      for (const module of plan.modules) {
        module.specBindings = [{ id: "engineering.core", duty: "required" }];
      }
      expect(
        runCli(
          [
            "run",
            "complete",
            "T-1",
            "--node",
            "plan-1",
            "--result",
            JSON.stringify(plan),
          ],
          cwd,
        ).status,
      ).toBe(0);
      expect(
        runCli(
          [
            "review",
            "start",
            "T-1",
            "--node",
            "review-plan-1",
            "--purpose",
            "feasibility",
            "--reviewed-attempt",
            "att-T-1-plan-1-1",
          ],
          cwd,
        ).status,
      ).toBe(0);
      const passed = runCli(
        [
          "review",
          "pass",
          "T-1",
          "--attempt",
          "att-T-1-review-plan-1-1",
          "--reviewed-attempt",
          "att-T-1-plan-1-1",
          "--evidence",
          REVIEW_EVIDENCE,
        ],
        cwd,
      );
      expect(passed.status).toBe(0);

      toDeliveryPoint(cwd);
      toIntegratePoint(cwd, false);
      finishRecord(cwd);
      expect(showJson(cwd).status).toBe("done");

      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      expect(getLifecycleSpecBindings(database, "T-1", 2)).toHaveLength(3);
      expect(getLifecycleSpecBindings(database, "T-2", 1)).toHaveLength(3);
      expect(getLifecycleSpecBindings(database, "T-3", 1)).toHaveLength(2);
      database.close();
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
