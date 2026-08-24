import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/store/database.js";
import {
  LEGACY_L1_EXECUTE_RESULT_SCHEMA,
  LEGACY_L1_RECORD_RESULT_SCHEMA,
} from "../../src/core/lifecycle/l1.js";
import {
  getAttempts,
  getEvidence,
  getSpecImpactResults,
} from "../../src/store/query.js";
import { parseJson, runCli, withInitializedDirectory } from "./helpers.js";

describe("tc run complete Spec Impact", () => {
  it("completes a pre-0003 stored revision through the public CLI without Spec Impact", () => {
    withInitializedDirectory((cwd) => {
      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "Legacy revision",
            "--level",
            "1",
            "--reason",
            "stored before Spec Impact",
          ],
          cwd,
        ).status,
      ).toBe(0);
      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      database.exec(
        "DROP TRIGGER lifecycle_revisions_immutable_update; DROP TRIGGER lifecycle_nodes_immutable_update; DROP TRIGGER obligation_definitions_immutable_delete;",
      );
      database
        .prepare(
          "UPDATE lifecycle_revisions SET compiler_version = 'tc-l1/1' WHERE task_id = 'T-1' AND revision = 1",
        )
        .run();
      database
        .prepare(
          `UPDATE lifecycle_nodes SET output_schema_json = CASE id
             WHEN 'execute-1' THEN ? WHEN 'record-1' THEN ? ELSE output_schema_json END
           WHERE task_id = 'T-1' AND lifecycle_revision = 1`,
        )
        .run(
          JSON.stringify(LEGACY_L1_EXECUTE_RESULT_SCHEMA),
          JSON.stringify(LEGACY_L1_RECORD_RESULT_SCHEMA),
        );
      database
        .prepare(
          "DELETE FROM obligation_definitions WHERE task_id = 'T-1' AND lifecycle_revision = 1 AND id = 'spec-impact-recorded'",
        )
        .run();
      database.close();

      expect(runCli(["run", "T-1"], cwd).status).toBe(0);
      const completed = runCli(
        [
          "run",
          "complete",
          "T-1",
          "--result",
          JSON.stringify({
            summary: "Legacy delivery",
            evidence: [
              {
                type: "validation",
                reference: "ref://legacy",
                summary: "Validated",
              },
            ],
            record: { summary: "Legacy record" },
          }),
        ],
        cwd,
      );
      expect(completed.status).toBe(0);
      expect(completed.stdout).toContain("Status: done");

      const checked = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      expect(getSpecImpactResults(checked, "T-1")).toEqual([]);
      checked.close();
    });
  });

  it("rejects extra Spec Impact by the old stored schema before Registry resolution", () => {
    withInitializedDirectory((cwd) => {
      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "Legacy strict schema",
            "--level",
            "1",
            "--reason",
            "stored before Spec Impact",
          ],
          cwd,
        ).status,
      ).toBe(0);
      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      database.exec(
        "DROP TRIGGER lifecycle_revisions_immutable_update; DROP TRIGGER lifecycle_nodes_immutable_update; DROP TRIGGER obligation_definitions_immutable_delete;",
      );
      database
        .prepare(
          "UPDATE lifecycle_revisions SET compiler_version = 'tc-l1/1' WHERE task_id = 'T-1' AND revision = 1",
        )
        .run();
      database
        .prepare(
          `UPDATE lifecycle_nodes SET output_schema_json = CASE id
             WHEN 'execute-1' THEN ? WHEN 'record-1' THEN ? ELSE output_schema_json END
           WHERE task_id = 'T-1' AND lifecycle_revision = 1`,
        )
        .run(
          JSON.stringify(LEGACY_L1_EXECUTE_RESULT_SCHEMA),
          JSON.stringify(LEGACY_L1_RECORD_RESULT_SCHEMA),
        );
      database
        .prepare(
          "DELETE FROM obligation_definitions WHERE task_id = 'T-1' AND lifecycle_revision = 1 AND id = 'spec-impact-recorded'",
        )
        .run();
      database.close();

      expect(runCli(["run", "T-1"], cwd).status).toBe(0);
      expect(
        runCli(
          [
            "run",
            "complete",
            "T-1",
            "--result",
            JSON.stringify({
              summary: "Legacy delivery",
              evidence: [
                {
                  type: "validation",
                  reference: "ref://legacy",
                  summary: "Validated",
                },
              ],
            }),
          ],
          cwd,
        ).status,
      ).toBe(0);
      expect(runCli(["run", "T-1", "--node", "record-1"], cwd).status).toBe(0);
      writeFileSync(
        join(cwd, ".taskcraft", "spec", "index.json"),
        "not-json\n",
        "utf8",
      );

      const rejected = runCli(
        [
          "run",
          "complete",
          "T-1",
          "--node",
          "record-1",
          "--result",
          JSON.stringify({
            summary: "Must be rejected by stored schema",
            specImpact: {
              outcome: "updated",
              updates: [
                {
                  specId: "engineering.delivery",
                  path: "docs/delivery.md",
                  digest: "a".repeat(64),
                  evidenceRefs: ["ev-T-1-att-T-1-execute-1-1-1"],
                },
              ],
            },
          }),
        ],
        cwd,
      );

      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("TC_LIFECYCLE_RESULT_INVALID");
      expect(rejected.stderr).not.toContain("TC_SPEC_REGISTRY_INVALID");
    });
  });

  it("records an updated current Registry snapshot with Task-owned evidence", () => {
    withInitializedDirectory((cwd) => {
      const spec = writeEngineeringSpec(cwd);
      const evidenceId = setupRecordAttempt(cwd, true);
      const impact = updatedImpact(spec.digest, evidenceId);

      const completed = runCli(
        [
          "run",
          "complete",
          "T-1",
          "--node",
          "record-1",
          "--result",
          JSON.stringify({ summary: "Spec updated", specImpact: impact }),
        ],
        cwd,
      );

      expect(completed.status).toBe(0);
      expect(completed.stdout).toContain("Status: done");
      const shown = runCli(["task", "show", "T-1", "--json"], cwd);
      const body = parseJson<{
        data: { specs: { impacts: Array<{ result: unknown }> } };
      }>(shown);
      expect(body.data.specs.impacts).toEqual([
        expect.objectContaining({ result: impact }),
      ]);
      const text = runCli(["task", "show", "T-1"], cwd);
      expect(text.stdout).toContain("Specs:");
      expect(text.stdout).toContain("Impact:");
      expect(text.stdout).toContain("engineering.delivery");
      expect(text.stdout).toContain("updated");
    });
  });

  it("rejects stale updated snapshots and foreign evidence without partial Record facts", () => {
    for (const variant of ["stale-digest", "foreign-evidence"] as const) {
      withInitializedDirectory((cwd) => {
        const spec = writeEngineeringSpec(cwd);
        const evidenceId = setupRecordAttempt(cwd);
        const impact = updatedImpact(
          variant === "stale-digest" ? "f".repeat(64) : spec.digest,
          variant === "foreign-evidence" ? "ev-foreign" : evidenceId,
        );

        const failed = runCli(
          [
            "run",
            "complete",
            "T-1",
            "--node",
            "record-1",
            "--result",
            JSON.stringify({ summary: "Spec updated", specImpact: impact }),
          ],
          cwd,
        );

        expect(failed.status).toBe(1);
        expect(failed.stderr).toContain("TC_SPEC_IMPACT_INVALID");
        const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
        try {
          expect(getSpecImpactResults(database, "T-1")).toEqual([]);
          expect(getEvidence(database, "T-1")).toHaveLength(1);
          expect(
            getAttempts(database, "T-1").find(
              (attempt) => attempt.nodeId === "record-1",
            ),
          ).toMatchObject({ status: "created", resultJson: null });
        } finally {
          database.close();
        }
      });
    }
  });

  it("stores domain candidates while leaving even an invalid Registry byte-for-byte unchanged", () => {
    withInitializedDirectory((cwd) => {
      setupRecordAttempt(cwd);
      const registryPath = join(cwd, ".taskcraft", "spec", "index.json");
      writeFileSync(registryPath, "not-json\n", "utf8");
      const before = readFileSync(registryPath);
      const candidate = {
        outcome: "candidate" as const,
        candidates: [
          {
            kind: "domain" as const,
            title: "Approval policy",
            rule: "Business rules require product-owner confirmation",
            reason: "Implementation evidence is not domain authority",
            ownerDecision: "Product owner must accept or reject the proposal",
          },
        ],
      };

      const completed = runCli(
        [
          "run",
          "complete",
          "T-1",
          "--node",
          "record-1",
          "--result",
          JSON.stringify({
            summary: "Candidate retained",
            specImpact: candidate,
          }),
        ],
        cwd,
      );

      expect(completed.status).toBe(0);
      expect(readFileSync(registryPath)).toEqual(before);
      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      try {
        expect(getSpecImpactResults(database, "T-1")[0]).toMatchObject({
          outcome: "candidate",
        });
      } finally {
        database.close();
      }
    });
  });
});

function setupRecordAttempt(cwd: string, bindSpec = false): string {
  const specArgs = bindSpec
    ? ["--specs", '[{"id":"engineering.delivery","duty":"required"}]']
    : [];
  expect(
    runCli(
      [
        "task",
        "new",
        "--title",
        "Spec Impact",
        "--level",
        "1",
        "--reason",
        "closure contract",
        ...specArgs,
      ],
      cwd,
    ).status,
  ).toBe(0);
  expect(runCli(["run", "T-1"], cwd).status).toBe(0);
  expect(
    runCli(
      [
        "run",
        "complete",
        "T-1",
        "--result",
        JSON.stringify({
          summary: "Delivery complete",
          evidence: [
            {
              type: "validation",
              reference: "tests/spec-impact.test.ts",
              summary: "Validated",
            },
          ],
        }),
      ],
      cwd,
    ).status,
  ).toBe(0);
  expect(runCli(["run", "T-1", "--node", "record-1"], cwd).status).toBe(0);
  return "ev-T-1-att-T-1-execute-1-1-1";
}

function writeEngineeringSpec(cwd: string) {
  const content = "# Delivery contract\n\nKeep the delivery DTO shared.\n";
  const path = "docs/delivery.md";
  mkdirSync(join(cwd, "docs"), { recursive: true });
  writeFileSync(join(cwd, path), content, "utf8");
  writeFileSync(
    join(cwd, ".taskcraft", "spec", "index.json"),
    `${JSON.stringify(
      {
        schemaVersion: "tc-spec-registry/v1",
        specs: [
          {
            id: "engineering.delivery",
            kind: "engineering",
            path,
            summary: "Delivery contract",
            appliesTo: ["src/**"],
            status: "active",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return {
    digest: createHash("sha256").update(content).digest("hex"),
  };
}

function updatedImpact(digest: string, evidenceId: string) {
  return {
    outcome: "updated" as const,
    updates: [
      {
        specId: "engineering.delivery",
        path: "docs/delivery.md",
        digest,
        evidenceRefs: [evidenceId],
      },
    ],
  };
}
