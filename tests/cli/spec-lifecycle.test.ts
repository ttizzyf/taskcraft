import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/store/database.js";
import {
  getAttempts,
  getLifecycleSpecBindings,
} from "../../src/store/query.js";
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
  it("blocks stale required Execute bindings until explicit refresh", () => {
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

      const blocked = runCli(["run", "T-1"], cwd);
      expect(blocked.status).toBe(1);
      expect(blocked.stderr).toContain("TC_SPEC_BINDING_STALE");
      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      expect(getAttempts(database, "T-1")).toEqual([]);
      database.close();

      const refresh = runCli(
        [
          "task",
          "spec",
          "refresh",
          "T-1",
          "--reason",
          "Core contract changed",
          "--expected-revision",
          "1",
        ],
        cwd,
      );
      expect(refresh.status).toBe(0);
      expect(refresh.stdout).toContain("Revision: 2");
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

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

  it("discloses but does not block recommended drift", () => {
    withInitializedDirectory((cwd) => {
      writeRegistry(cwd);
      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "Recommended",
            "--level",
            "1",
            "--reason",
            "advisory contract",
            "--specs",
            '[{"id":"engineering.core","duty":"recommended"}]',
          ],
          cwd,
        ).status,
      ).toBe(0);
      writeFileSync(
        join(cwd, "docs", "core.md"),
        "# Advisory changed\n",
        "utf8",
      );

      const run = runCli(["run", "T-1"], cwd);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("Attempt: att-T-1-execute-1-1");
    });
  });

  it("preserves Registry errors for required bindings but does not block recommended bindings", () => {
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
      unlinkSync(join(cwd, "docs", "core.md"));

      const blocked = runCli(["run", "T-1"], cwd);
      expect(blocked.status).toBe(1);
      expect(blocked.stderr).toContain("TC_SPEC_BINDING_STALE");
      expect(blocked.stderr).toContain("registry_unavailable");
      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      expect(getAttempts(database, "T-1")).toEqual([]);
      database.close();
    });

    withInitializedDirectory((cwd) => {
      writeRegistry(cwd);
      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "Recommended",
            "--level",
            "1",
            "--reason",
            "recommended contract",
            "--specs",
            '[{"id":"engineering.core","duty":"recommended"}]',
          ],
          cwd,
        ).status,
      ).toBe(0);
      unlinkSync(join(cwd, "docs", "core.md"));

      expect(runCli(["run", "T-1"], cwd).status).toBe(0);
    });

    withInitializedDirectory((cwd) => {
      writeRegistry(cwd);
      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "Recommended",
            "--level",
            "1",
            "--reason",
            "recommended contract",
            "--specs",
            '[{"id":"engineering.core","duty":"recommended"}]',
          ],
          cwd,
        ).status,
      ).toBe(0);
      writeFileSync(
        join(cwd, ".taskcraft", "spec", "index.json"),
        "not-json",
        "utf8",
      );

      const invalidRegistry = runCli(["run", "T-1"], cwd);
      expect(invalidRegistry.status).toBe(0);
      expect(invalidRegistry.stdout).toContain("registry_unavailable");
    });
  });

  it("blocks a stale required delivery Review before creating its attempt", () => {
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

      const blocked = runCli(
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
      expect(blocked.status).toBe(1);
      expect(blocked.stderr).toContain("TC_SPEC_BINDING_STALE");
      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      expect(
        getAttempts(database, "T-1").filter(
          (attempt) => attempt.nodeId === "review-1",
        ),
      ).toEqual([]);
      database.close();
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
