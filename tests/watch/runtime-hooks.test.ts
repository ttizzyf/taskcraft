// Watch runtime/diagnostics same-source contract: rows written by the run
// attach reducer (never a fixture) surface in /api/runtime, hookTests read
// from .taskcraft/config.json surface in /api/runtime and drive the
// diagnostics hook anomalies (failed test, version drift, missing test).

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { run, runAttach, taskNew } from "../../src/core/reducer.js";
import { openDatabase } from "../../src/store/database.js";
import { applyMigrations } from "../../src/store/migrations.js";
import type { WatchDiagnostics, WatchRuntime } from "../../src/watch/routes.js";
import { getJson, withProject, withServer } from "./helpers.js";

describe("watch runtime same-source", () => {
  it("serves rows written by the run attach reducer and the persisted hookTests", async () => {
    await withProject(null, async (projectDir) => {
      mkdirSync(join(projectDir, ".taskcraft"), { recursive: true });
      const database = openDatabase(
        join(projectDir, ".taskcraft", "taskcraft.db"),
      );

      try {
        applyMigrations(database, resolve("migrations"));
        const { taskId } = taskNew(database, {
          title: "Observed task",
          level: 1,
          reason: "reason",
        });
        run(database, taskId, { host: "codex" });
        runAttach(database, taskId, {
          nodeId: "execute-1",
          hostRunId: "hr-1",
          host: "codex",
          observationStatus: "running",
        });
      } finally {
        database.close();
      }

      writeFileSync(
        join(projectDir, ".taskcraft", "config.json"),
        `${JSON.stringify(
          {
            takeOver: "ask",
            agents: ["claude"],
            hookTests: {
              claude: {
                testedAt: "2026-08-13T00:00:00.000Z",
                version: "2.1.220",
                ok: true,
                enforced: true,
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await withServer(projectDir, {}, async (baseUrl) => {
        const response = await getJson(baseUrl, "/api/runtime");
        expect(response.status).toBe(200);

        const body = response.body as WatchRuntime;
        expect(body.runs).toHaveLength(1);
        expect(body.runs[0]).toMatchObject({
          taskId: "T-1",
          nodeAttemptId: "att-T-1-execute-1-1",
          host: "codex",
          hostRunId: "hr-1",
          observationStatus: "running",
        });
        expect(body.byTask).toEqual([
          {
            taskId: "T-1",
            total: 1,
            hosts: ["codex"],
            lastSeenAt: body.runs[0]?.lastSeenAt,
          },
        ]);
        expect(body.hookTests.claude).toMatchObject({
          testedAt: "2026-08-13T00:00:00.000Z",
          version: "2.1.220",
          ok: true,
          enforced: true,
        });
      });
    });
  });
});

describe("watch diagnostics hook anomalies", () => {
  it("reports failed hook tests and version drift from config.hookTests", async () => {
    await withProject("five-status", async (projectDir) => {
      const hooksDir = join(projectDir, ".taskcraft", "hooks");
      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(
        join(hooksDir, "entry.sh"),
        `node "${resolve("dist/hooks/entry.js")}" "$(dirname "$0")/../config.json"\n`,
        "utf8",
      );
      writeFileSync(
        join(hooksDir, "stop.sh"),
        `node "${resolve("dist/hooks/stop.js")}" "$(dirname "$0")/../config.json"\n`,
        "utf8",
      );
      writeFileSync(
        join(projectDir, ".taskcraft", "config.json"),
        `${JSON.stringify(
          {
            takeOver: "ask",
            hookTests: {
              codex: {
                testedAt: "2020-01-01T00:00:00.000Z",
                version: "1.0.0",
                ok: true,
                enforced: true,
              },
              claude: {
                testedAt: "2026-08-13T00:00:00.000Z",
                version: "2.1.220",
                ok: false,
                enforced: false,
                failure: "stop block missing",
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await withServer(projectDir, {}, async (baseUrl) => {
        const response = await getJson(baseUrl, "/api/diagnostics");
        const body = response.body as WatchDiagnostics;
        const codes = body.items.map((item) => item.code);

        expect(codes).toContain("TC_ADAPTER_HOOK_TEST_FAILED");
        expect(codes).toContain("TC_HOOK_VERSION_DRIFT");

        const failed = body.items.find(
          (item) => item.code === "TC_ADAPTER_HOOK_TEST_FAILED",
        );
        expect(failed?.problem).toContain("stop block missing");

        const drift = body.items.find(
          (item) => item.code === "TC_HOOK_VERSION_DRIFT",
        );
        expect(drift?.problem).toContain("codex");
      });
    });
  });

  it("reports installed hooks that were never field-tested", async () => {
    await withProject("five-status", async (projectDir) => {
      mkdirSync(join(projectDir, ".taskcraft", "hooks"), { recursive: true });
      writeFileSync(
        join(projectDir, ".taskcraft", "hooks", "entry.sh"),
        `node "${resolve("dist/hooks/entry.js")}"\n`,
        "utf8",
      );
      writeFileSync(
        join(projectDir, ".taskcraft", "config.json"),
        `${JSON.stringify({ takeOver: "ask" }, null, 2)}\n`,
        "utf8",
      );

      await withServer(projectDir, {}, async (baseUrl) => {
        const response = await getJson(baseUrl, "/api/diagnostics");
        const codes = (response.body as WatchDiagnostics).items.map(
          (item) => item.code,
        );

        expect(codes).toContain("TC_HOOK_TEST_MISSING");
      });
    });
  });
});
