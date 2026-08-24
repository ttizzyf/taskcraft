import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildTaskShowData } from "../../src/commands/task-show.js";
import { ERROR_CODES } from "../../src/core/errors.js";
import { run, runComplete, taskNew } from "../../src/core/reducer.js";
import { buildTaskDetail } from "../../src/watch/routes.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";

describe("shared Spec delivery view", () => {
  it("feeds task show and Watch the same bindings, drift and Impact DTO", () => {
    const temporary = createTemporaryDirectory();
    const database = createMigratedDatabase();
    try {
      const spec = writeRegistry(temporary.path, "Shared delivery contract\n");
      const { taskId } = taskNew(database, {
        title: "Shared DTO",
        level: 1,
        reason: "CLI and Watch must agree",
        initialSpecBindings: [
          {
            specId: "engineering.delivery",
            kind: "engineering",
            path: "docs/delivery.md",
            digest: spec.digest,
            duty: "required",
          },
        ],
      });
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Delivered",
          evidence: [
            {
              type: "validation",
              reference: "tests/spec/delivery.test.ts",
              summary: "Validated",
            },
          ],
          record: {
            summary: "Recorded",
            specImpact: {
              outcome: "none",
              reason: "No reusable contract changed",
            },
          },
        },
      });

      const taskShow = buildTaskShowData(database, taskId, temporary.path);
      const watch = buildTaskDetail(database, taskId, temporary.path)!;
      expect(taskShow.specs).toEqual(watch.specs);
      expect(taskShow.specs.bindings).toHaveLength(2);
      expect(
        taskShow.specs.bindings.every(
          (binding) => binding.drift.status === "current",
        ),
      ).toBe(true);
      expect(taskShow.specs.impacts[0]?.result).toEqual({
        outcome: "none",
        reason: "No reusable contract changed",
      });

      writeFileSync(
        join(temporary.path, "docs", "delivery.md"),
        "Changed delivery contract\n",
        "utf8",
      );
      const staleTaskShow = buildTaskShowData(database, taskId, temporary.path);
      const staleWatch = buildTaskDetail(database, taskId, temporary.path)!;
      expect(staleTaskShow.specs).toEqual(staleWatch.specs);
      expect(
        staleTaskShow.specs.bindings.every(
          (binding) =>
            binding.drift.status === "stale" &&
            binding.drift.reasons.includes("digest_changed"),
        ),
      ).toBe(true);
    } finally {
      database.close();
      temporary.cleanup();
    }
  });

  it("returns a shared Registry issue instead of hiding unavailable bindings", () => {
    const temporary = createTemporaryDirectory();
    const database = createMigratedDatabase();
    try {
      const spec = writeRegistry(temporary.path, "Delivery contract\n");
      const { taskId } = taskNew(database, {
        title: "Registry issue",
        level: 1,
        reason: "visible failure",
        initialSpecBindings: [
          {
            specId: "engineering.delivery",
            kind: "engineering",
            path: "docs/delivery.md",
            digest: spec.digest,
            duty: "recommended",
          },
        ],
      });
      writeFileSync(
        join(temporary.path, ".taskcraft", "spec", "index.json"),
        "not-json",
        "utf8",
      );

      const taskShow = buildTaskShowData(database, taskId, temporary.path);
      const watch = buildTaskDetail(database, taskId, temporary.path)!;
      expect(taskShow.specs).toEqual(watch.specs);
      expect(taskShow.specs.registryIssue?.code).toBe(
        "TC_SPEC_REGISTRY_INVALID",
      );
      expect(taskShow.specs.bindings[0]?.drift).toEqual({
        status: "stale",
        reasons: ["registry_unavailable"],
      });
    } finally {
      database.close();
      temporary.cleanup();
    }
  });

  it("fails task show and Watch with the same stable error for damaged Impact details", () => {
    const temporary = createTemporaryDirectory();
    const database = createMigratedDatabase();
    try {
      writeRegistry(temporary.path, "Delivery contract\n");
      const { taskId } = taskNew(database, {
        title: "Damaged Impact",
        level: 1,
        reason: "stable shared failure",
      });
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Delivered",
          evidence: [
            {
              type: "validation",
              reference: "tests/spec/delivery.test.ts",
              summary: "Validated",
            },
          ],
          record: {
            summary: "Recorded",
            specImpact: { outcome: "none", reason: "No reusable rule" },
          },
        },
      });
      database.exec("DROP TRIGGER spec_impact_results_immutable_update");
      database
        .prepare("UPDATE spec_impact_results SET details_json = 'not-json'")
        .run();

      const taskShowError = captureTaskcraftError(() =>
        buildTaskShowData(database, taskId, temporary.path),
      );
      const watchError = captureTaskcraftError(() =>
        buildTaskDetail(database, taskId, temporary.path),
      );

      expect(taskShowError.code).toBe(ERROR_CODES.TC_SPEC_IMPACT_INVALID);
      expect(watchError.code).toBe(ERROR_CODES.TC_SPEC_IMPACT_INVALID);
      expect(taskShowError.problem).toBe(watchError.problem);
    } finally {
      database.close();
      temporary.cleanup();
    }
  });
});

function writeRegistry(projectDir: string, content: string) {
  mkdirSync(join(projectDir, ".taskcraft", "spec"), { recursive: true });
  mkdirSync(join(projectDir, "docs"), { recursive: true });
  writeFileSync(join(projectDir, "docs", "delivery.md"), content, "utf8");
  writeFileSync(
    join(projectDir, ".taskcraft", "spec", "index.json"),
    JSON.stringify({
      schemaVersion: "tc-spec-registry/v1",
      specs: [
        {
          id: "engineering.delivery",
          kind: "engineering",
          path: "docs/delivery.md",
          summary: "Delivery contract",
          appliesTo: ["src/**"],
          status: "active",
        },
      ],
    }),
    "utf8",
  );
  return { digest: createHash("sha256").update(content).digest("hex") };
}
