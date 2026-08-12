import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/store/database.js";
import { applyMigrations } from "../../src/store/migrations.js";
import { createWatchServer } from "../../src/watch/server.js";
import type { WatchServerOptions } from "../../src/watch/server.js";
import type {
  WatchBoard,
  WatchDiagnostics,
  WatchRuntime,
  WatchTaskDetail,
} from "../../src/watch/routes.js";
import { loadFixtureFile } from "../helpers/load-fixture.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

const STATIC_DIRECTORY = fileURLToPath(new URL("../../watch", import.meta.url));

interface ErrorBody {
  error: { code: string; problem: string };
}

/** Creates a temp project, optionally loading a fixture into
 * .taskcraft/taskcraft.db, runs the callback and cleans up. */
async function withProject(
  fixture: string | null,
  callback: (projectDir: string) => Promise<void>,
): Promise<void> {
  const temporary = createTemporaryDirectory();

  try {
    const projectDir = temporary.path;

    if (fixture !== null) {
      mkdirSync(join(projectDir, ".taskcraft"), { recursive: true });
      const database = openDatabase(
        join(projectDir, ".taskcraft", "taskcraft.db"),
      );

      try {
        applyMigrations(database, resolve("migrations"));
        loadFixtureFile(database, fixture);
      } finally {
        database.close();
      }
    }

    await callback(projectDir);
  } finally {
    temporary.cleanup();
  }
}

async function withServer(
  projectDir: string,
  extra: Partial<WatchServerOptions>,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const { server, port } = await createWatchServer({
    projectDir,
    staticDir: STATIC_DIRECTORY,
    ...extra,
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await callback(baseUrl);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

async function getJson(
  baseUrl: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: (await response.json()) as unknown };
}

describe("watch server", () => {
  it("binds 127.0.0.1 on a random port when port is 0", async () => {
    await withProject(null, async (projectDir) => {
      const { server, port } = await createWatchServer({
        projectDir,
        staticDir: STATIC_DIRECTORY,
      });

      try {
        const address = server.address();

        expect(port).toBeGreaterThan(0);
        expect(
          typeof address === "object" && address !== null ? address.port : 0,
        ).toBe(port);
        expect(
          typeof address === "object" && address !== null
            ? address.address
            : null,
        ).toBe("127.0.0.1");
      } finally {
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
      }
    });
  });

  it("groups the five public statuses with full card summaries", async () => {
    await withProject("five-status", async (projectDir) => {
      await withServer(projectDir, {}, async (baseUrl) => {
        const response = await getJson(baseUrl, "/api/board");
        expect(response.status).toBe(200);

        const body = response.body as WatchBoard;
        expect(body.groups.active.map((card) => card.id)).toEqual(["T-502"]);
        expect(body.groups.waiting.map((card) => card.id)).toEqual(["T-503"]);
        expect(body.groups.queued.map((card) => card.id)).toEqual(["T-501"]);
        expect(body.groups.done.map((card) => card.id)).toEqual(["T-504"]);
        expect(body.groups.cancelled.map((card) => card.id)).toEqual(["T-505"]);
        expect(body.groups.active[0]).toMatchObject({
          id: "T-502",
          title: "Active task",
          level: 1,
          status: "active",
          waitingReason: null,
          node: "execute-1",
          nodeKind: "execute",
          doneObligations: 0,
          totalObligations: 3,
          host: "host-1",
          next: "tc run complete T-502",
        });
        expect(typeof body.groups.active[0]?.lastActivity).toBe("string");
        expect(body.groups.waiting[0]?.waitingReason).toBe("needs_input");
        expect(body.groups.done[0]).toMatchObject({
          status: "done",
          doneObligations: 3,
          totalObligations: 3,
          next: null,
        });
        expect(body.groups.cancelled[0]).toMatchObject({
          status: "cancelled",
          next: "tc task show T-505",
        });
        expect(typeof body.generatedAt).toBe("string");
      });
    });
  });

  it("returns the full detail for a known task and 404 JSON for unknown ids", async () => {
    await withProject("five-status", async (projectDir) => {
      await withServer(projectDir, {}, async (baseUrl) => {
        const detail = await getJson(baseUrl, "/api/task/T-504");
        expect(detail.status).toBe(200);

        const body = detail.body as WatchTaskDetail;
        expect(body.task).toMatchObject({
          title: "Done task",
          level: 1,
          status: "done",
          taskRevision: 3,
          lifecycleRevision: 1,
        });
        expect(body.projection.nodeStatuses).toHaveLength(2);
        expect(body.projection.doneObligations).toBe(3);
        expect(body.projection.totalObligations).toBe(3);
        expect(body.graph.nodes).toHaveLength(2);
        expect(body.attempts).toHaveLength(2);
        expect(body.evidence).toHaveLength(2);
        expect(body.obligationResults).toHaveLength(3);
        expect(body.events.length).toBeGreaterThanOrEqual(1);
        expect(body.next).toBeNull();

        const missing = await getJson(baseUrl, "/api/task/T-999");
        expect(missing.status).toBe(404);
        expect((missing.body as ErrorBody).error.code).toBe(
          "TC_TASK_NOT_FOUND",
        );

        const extra = await getJson(baseUrl, "/api/task/T-504/extra");
        expect(extra.status).toBe(404);
      });
    });
  });

  it("lists agent runs with a per-task summary", async () => {
    await withProject("l3-stale", async (projectDir) => {
      await withServer(projectDir, {}, async (baseUrl) => {
        const response = await getJson(baseUrl, "/api/runtime");
        expect(response.status).toBe(200);

        const body = response.body as WatchRuntime;
        expect(body.runs.length).toBeGreaterThanOrEqual(1);
        expect(body.runs[0]).toMatchObject({
          taskId: "T-308",
          host: "host-1",
          observationStatus: "stale",
        });
        expect(body.byTask[0]).toMatchObject({
          taskId: "T-308",
          total: 1,
          hosts: ["host-1"],
        });
        expect(typeof body.byTask[0]?.lastSeenAt).toBe("string");
        expect(typeof body.generatedAt).toBe("string");
      });
    });
  });

  it("reports blocker and observation anomalies and stays empty on a healthy store", async () => {
    await withProject("retry-exhaustion", async (projectDir) => {
      await withServer(projectDir, {}, async (baseUrl) => {
        const response = await getJson(baseUrl, "/api/diagnostics");
        const body = response.body as WatchDiagnostics;
        const codes = body.items.map((item) => item.code);

        expect(codes).toContain("TC_REQUIRED_EVIDENCE_MISSING");
        expect(codes).toContain("TC_RETRIES_EXHAUSTED");

        for (const item of body.items) {
          expect(item.problem).toBeTruthy();
          expect(item.impact).toBeTruthy();
          expect(item.remediation).toBeTruthy();
          expect(item.source).toBeTruthy();
        }
      });
    });

    await withProject("five-status", async (projectDir) => {
      await withServer(projectDir, {}, async (baseUrl) => {
        const response = await getJson(baseUrl, "/api/diagnostics");
        expect((response.body as WatchDiagnostics).items).toEqual([]);
      });
    });
  });

  it("reports an uninitialized store and injected conflict or unsupported-host rows", async () => {
    await withProject(null, async (projectDir) => {
      await withServer(projectDir, {}, async (baseUrl) => {
        const response = await getJson(baseUrl, "/api/diagnostics");
        const codes = (response.body as WatchDiagnostics).items.map(
          (item) => item.code,
        );
        expect(codes).toEqual(["TC_NOT_INITIALIZED"]);

        const board = await getJson(baseUrl, "/api/board");
        expect((board.body as WatchBoard).groups.active).toEqual([]);
      });
    });

    await withProject("five-status", async (projectDir) => {
      const database = openDatabase(
        join(projectDir, ".taskcraft", "taskcraft.db"),
      );

      database
        .prepare(
          `INSERT INTO blockers (
             id, task_id, lifecycle_revision, node_id, kind, waiting_reason,
             status, reason, remediation_command, created_at, resolved_at
           ) VALUES ('blk-conflict', 'T-502', 1, 'execute-1', 'conflict',
             'blocked_dependency', 'open', 'revision conflict', 'tc status',
             '2026-08-11T00:00:00.000Z', NULL)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO agent_runs (
             id, task_id, node_attempt_id, host, host_run_id, host_session_id,
             observation_status, last_seen_at, finish_reason, observation_json
           ) VALUES ('run-unsupported', 'T-502', 'att-T-502-execute-1-1',
             'codex-legacy', NULL, NULL, 'unsupported',
             '2026-08-11T00:00:00.000Z', NULL, '{}')`,
        )
        .run();
      database.close();

      await withServer(projectDir, {}, async (baseUrl) => {
        const response = await getJson(baseUrl, "/api/diagnostics");
        const codes = (response.body as WatchDiagnostics).items.map(
          (item) => item.code,
        );
        expect(codes).toContain("TC_REVISION_CONFLICT");
        expect(codes).toContain("TC_ADAPTER_UNSUPPORTED");
      });
    });
  });

  it("rejects write methods with 405 and unknown api paths with 404 JSON", async () => {
    await withProject("five-status", async (projectDir) => {
      await withServer(projectDir, {}, async (baseUrl) => {
        for (const method of ["POST", "PUT", "DELETE"]) {
          const response = await fetch(`${baseUrl}/api/board`, { method });

          expect(response.status).toBe(405);
          expect(response.headers.get("allow")).toBe("GET");
          expect(((await response.json()) as ErrorBody).error.code).toBe(
            "TC_WATCH_METHOD_NOT_ALLOWED",
          );
        }

        const unknown = await getJson(baseUrl, "/api/nope");
        expect(unknown.status).toBe(404);
        expect((unknown.body as ErrorBody).error.code).toBe(
          "TC_WATCH_API_NOT_FOUND",
        );
      });
    });
  });

  it("serves static assets with correct MIME, no-cache and traversal guards", async () => {
    await withProject(null, async (projectDir) => {
      await withServer(projectDir, {}, async (baseUrl) => {
        const index = await fetch(`${baseUrl}/`);
        expect(index.status).toBe(200);
        expect(index.headers.get("content-type")).toBe(
          "text/html; charset=utf-8",
        );
        expect(index.headers.get("cache-control")).toBe("no-cache");
        expect(await index.text()).toContain("Taskcraft Watch");

        // HEAD is read-only: same headers, no body.
        const head = await fetch(`${baseUrl}/`, { method: "HEAD" });
        expect(head.status).toBe(200);
        expect(head.headers.get("content-type")).toBe(
          "text/html; charset=utf-8",
        );
        expect(await head.text()).toBe("");

        // Deep links are hash routes: any #/task/<id> still fetches "/" and
        // the server only ever serves the app shell plus the JSON API.
        const deepLink = await fetch(`${baseUrl}/#/task/T-1`);
        expect(deepLink.status).toBe(200);
        expect(await deepLink.text()).toContain("Taskcraft Watch");

        const js = await fetch(`${baseUrl}/app.js`);
        expect(js.status).toBe(200);
        expect(js.headers.get("content-type")).toBe(
          "text/javascript; charset=utf-8",
        );

        const css = await fetch(`${baseUrl}/style.css`);
        expect(css.status).toBe(200);
        expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");

        const missing = await fetch(`${baseUrl}/missing.js`);
        expect(missing.status).toBe(404);

        for (const path of [
          "/..%2F..%2Fpackage.json",
          "/%2e%2e/%2e%2e/package.json",
          "/..%2Ftaskcraft.db",
        ]) {
          const response = await fetch(`${baseUrl}${path}`);
          expect(response.status).toBe(404);
        }
      });
    });
  });
});
