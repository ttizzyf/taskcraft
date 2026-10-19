import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/store/database.js";
import { getAttempts, getReviewFindings } from "../../src/store/query.js";
import { runCli, withInitializedDirectory } from "./helpers.js";

const REQUIRED_SPECS = '[{"id":"engineering.core","duty":"required"}]';

describe("tc Spec successor Attempt gates", () => {
  it("returns the checked Spec snapshot in a review-changes successor Brief", () => {
    withInitializedDirectory((cwd) => {
      writeRegistry(cwd);
      createL2ReviewWithRequiredBinding(cwd);

      const changes = runCli(
        [
          "review",
          "changes",
          "T-1",
          "--attempt",
          "att-T-1-review-1-1",
          "--reviewed-attempt",
          "att-T-1-execute-1-1",
          "--finding",
          "Update implementation",
        ],
        cwd,
      );

      expect(changes.status).toBe(0);
      expect(changes.stdout).toContain("Node Brief");
      expect(changes.stdout).toContain("engineering.core");
      expect(changes.stdout).toContain("att-T-1-execute-1-2");
    });
  });

  it("retries after the bound document changed", () => {
    withInitializedDirectory((cwd) => {
      writeRegistry(cwd);
      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "Retry gate",
            "--level",
            "1",
            "--reason",
            "required contract",
            "--specs",
            REQUIRED_SPECS,
          ],
          cwd,
        ).status,
      ).toBe(0);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);
      expect(
        runCli(
          [
            "run",
            "fail",
            "T-1",
            "--attempt",
            "att-T-1-execute-1-1",
            "--reason",
            "failed",
          ],
          cwd,
        ).status,
      ).toBe(0);
      writeFileSync(join(cwd, "docs", "core.md"), "# Changed\n", "utf8");

      const retry = runCli(
        [
          "run",
          "retry",
          "T-1",
          "--attempt",
          "att-T-1-execute-1-1",
          "--reason",
          "retry",
        ],
        cwd,
      );

      // Editing a bound document is not a reason to refuse the retry: the
      // successor attempt is created under the recorded binding.
      expect(retry.status).toBe(0);
      expect(retry.stdout).toContain("att-T-1-execute-1-2");
      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      expect(
        getAttempts(database, "T-1").filter(
          (attempt) => attempt.nodeId === "execute-1",
        ),
      ).toHaveLength(2);
      database.close();
    });
  });

  it("creates the review-changes successor Execute Attempt after the document changed", () => {
    withInitializedDirectory((cwd) => {
      writeRegistry(cwd);
      createL2ReviewWithRequiredBinding(cwd);
      writeFileSync(join(cwd, "docs", "core.md"), "# Changed\n", "utf8");

      const changes = runCli(
        [
          "review",
          "changes",
          "T-1",
          "--attempt",
          "att-T-1-review-1-1",
          "--reviewed-attempt",
          "att-T-1-execute-1-1",
          "--finding",
          "Update implementation",
        ],
        cwd,
      );

      expect(changes.status).toBe(0);
      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      expect(
        getAttempts(database, "T-1").filter(
          (attempt) => attempt.nodeId === "execute-1",
        ),
      ).toHaveLength(2);
      expect(
        getAttempts(database, "T-1").find(
          (attempt) => attempt.id === "att-T-1-review-1-1",
        )?.status,
      ).toBe("finished");
      expect(getReviewFindings(database, "T-1")).toHaveLength(1);
      database.close();
    });
  });
});

function createL2ReviewWithRequiredBinding(cwd: string): void {
  expect(
    runCli(
      [
        "task",
        "new",
        "--title",
        "Review changes gate",
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
  expect(
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
        "att-T-1-execute-1-1",
      ],
      cwd,
    ).status,
  ).toBe(0);
}

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
