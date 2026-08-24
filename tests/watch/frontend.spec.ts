// Playwright smoke for the watch frontend: real server + fixture-backed
// stores, desktop (1280x800) and mobile (390x844) viewports. Covers the
// status matrix from product.md §7 with representative samples: five public
// statuses, L1/L3 graphs, waiting reasons, Review independence disclosure,
// stale/finished observations next to active/done tasks, deep links and
// refresh persistence, and no-overflow / reachability checks.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "playwright/test";
import type { Page } from "playwright/test";

import { openDatabase } from "../../src/store/database.js";
import { applyMigrations } from "../../src/store/migrations.js";
import { createWatchServer } from "../../src/watch/server.js";
import type { WatchServer } from "../../src/watch/server.js";
import { loadFixtureFile } from "../helpers/load-fixture.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

const STATIC_DIRECTORY = fileURLToPath(new URL("../../watch", import.meta.url));
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

let baseUrl = "";
let server: WatchServer | undefined;
let temporary: ReturnType<typeof createTemporaryDirectory>;

test.beforeAll(async () => {
  temporary = createTemporaryDirectory();
  const projectDir = temporary.path;

  mkdirSync(join(projectDir, ".taskcraft"), { recursive: true });
  const database = openDatabase(join(projectDir, ".taskcraft", "taskcraft.db"));

  try {
    applyMigrations(database, resolve("migrations"));

    for (const fixture of ["five-status", "l3-stale", "retry-exhaustion"]) {
      loadFixtureFile(database, fixture);
    }

    // A finished observation for the still-active T-502: "finished but
    // result not collected" must not flip the task status (observations
    // never drive task completion).
    database
      .prepare(
        `INSERT INTO agent_runs (
           id, task_id, node_attempt_id, host, host_run_id, host_session_id,
           observation_status, last_seen_at, finish_reason, observation_json
         ) VALUES ('run-finished', 'T-502', 'att-T-502-execute-1-1', 'claude',
           'host-run-1', 'host-session-1', 'finished',
           '2026-08-11T00:00:00.000Z', 'completed', '{}')`,
      )
      .run();

    const specBody = "# Watch delivery\n\nRender the shared DTO only.\n";
    const specDigest = createHash("sha256").update(specBody).digest("hex");
    mkdirSync(join(projectDir, "docs"), { recursive: true });
    mkdirSync(join(projectDir, ".taskcraft", "spec"), { recursive: true });
    writeFileSync(join(projectDir, "docs", "watch-delivery.md"), specBody);
    writeFileSync(
      join(projectDir, ".taskcraft", "spec", "index.json"),
      JSON.stringify({
        schemaVersion: "tc-spec-registry/v1",
        specs: [
          {
            id: "engineering.watch-delivery",
            kind: "engineering",
            path: "docs/watch-delivery.md",
            summary: "Watch delivery contract",
            appliesTo: ["watch/**"],
            status: "active",
          },
        ],
      }),
    );
    const insertBinding = database.prepare(
      `INSERT INTO lifecycle_spec_bindings (
         task_id, lifecycle_revision, node_id, spec_id, spec_kind, spec_path,
         spec_digest, duty, source_kind, source_task_id, source_attempt_id,
         created_by, created_at
       ) VALUES ('T-308', 1, ?, 'engineering.watch-delivery', 'engineering',
         'docs/watch-delivery.md', ?, 'required', 'task_create', NULL, NULL,
         'fixture', '2026-08-11T00:00:00.000Z')`,
    );
    insertBinding.run("execute-1", specDigest);
    insertBinding.run("review-execute-1", specDigest);
  } finally {
    database.close();
  }

  const started = await createWatchServer({
    projectDir,
    staticDir: STATIC_DIRECTORY,
  });
  server = started;
  baseUrl = `http://127.0.0.1:${started.port}`;
});

test.afterAll(async () => {
  server?.server.closeAllConnections();
  await new Promise<void>((done) => server?.server.close(() => done()));
  temporary?.cleanup();
});

/** Asserts the page has no horizontal overflow at the given viewport. */
async function expectNoHorizontalOverflow(page: Page, viewportWidth: number) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(metrics.clientWidth).toBeLessThanOrEqual(viewportWidth);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(viewportWidth);
}

async function expectDetailSectionsDoNotOverlap(page: Page) {
  const boxes = await page
    .locator(".detail-main > .section")
    .evaluateAll((sections) =>
      sections.map((section) => {
        const rect = section.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }),
    );
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index]!.top).toBeGreaterThanOrEqual(
      boxes[index - 1]!.bottom - 1,
    );
  }
}

test.describe("desktop smoke", () => {
  test("board groups the five statuses with full card summaries", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/#/board`);
    await expect(page.getByTestId("board-view")).toBeVisible();

    for (const status of ["active", "waiting", "queued", "done", "cancelled"]) {
      await expect(
        page.locator(`.group[data-status="${status}"]`),
      ).toBeVisible();
    }

    // five-status fixture: one task per public status.
    await expect(page.locator('[data-task-id="T-502"]')).toContainText(
      "Active task",
    );
    await expect(page.locator('[data-task-id="T-504"]')).toContainText(
      "Done task",
    );
    await expect(page.locator('[data-task-id="T-505"]')).toContainText(
      "Cancelled task",
    );
    await expect(page.locator('[data-task-id="T-501"]')).toContainText(
      "Queued task",
    );

    // waiting trio on the needs_input card: reason, responsible, recovery.
    const waitingCard = page.locator('[data-task-id="T-503"] .card-blocker');
    await expect(waitingCard).toContainText(
      "Needs input — Schema decision needed",
    );
    await expect(waitingCard).toContainText("Responsible: User");
    await expect(waitingCard).toContainText("Recovery: None recorded");

    // retry-exhaustion card carries the recovery command as next + blocker.
    const retryCard = page.locator('[data-task-id="T-107"]');
    await expect(retryCard).toContainText("Retries exhausted");
    await expect(retryCard).toContainText("tc run T-107 --node execute-1");

    await expectNoHorizontalOverflow(page, DESKTOP.width);
  });

  test("card click opens detail; deep link survives reload", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/#/board`);

    await page.locator('[data-task-id="T-502"]').click();
    await expect(page).toHaveURL(/#\/task\/T-502$/);
    await expect(page.getByTestId("detail-view")).toBeVisible();
    await expect(page.locator(".detail-head h1")).toHaveText("Active task");
    await expect(page.getByTestId("next-command")).toHaveText(
      "tc run complete T-502",
    );

    // Deep link direct load + refresh persistence.
    await page.goto(`${baseUrl}/#/task/T-308`);
    await expect(page.getByTestId("detail-view")).toBeVisible();
    await expect(page.locator(".detail-head h1")).toContainText(
      "Stale host observation",
    );
    await page.reload();
    await expect(page.getByTestId("detail-view")).toBeVisible();
    await expect(page.locator(".detail-head h1")).toContainText(
      "Stale host observation",
    );

    // L3 graph with status symbols and same-actor independence (text only).
    await expect(
      page.locator('.node-list [data-node-status="satisfied"]'),
    ).toHaveCount(4);
    await expect(page.locator(".node-list")).toContainText("✓");
    await expect(page.locator(".node-list")).toContainText("▶");
    await expect(page.locator(".node-list")).toContainText("⊗");
    await expect(page.locator(".node-list")).toContainText(
      "att-T-308-review-execute-1-1",
    );
    await expect(page.getByTestId("review-table")).toContainText("Same actor");
    await expect(page.getByTestId("review-table")).toContainText(
      "context-only",
    );
    const specs = page.locator('[data-section="specs"]');
    await expect(specs).toBeVisible();
    await expect(specs).toContainText("engineering.watch-delivery");
    await expect(specs).toContainText("docs/watch-delivery.md");
    await expect(specs.locator(".status-tag.current")).toHaveCount(2);
    await expectDetailSectionsDoNotOverlap(page);
    await expectNoHorizontalOverflow(page, DESKTOP.width);

    // Unknown task shows an explicit error, not silence.
    await page.goto(`${baseUrl}/#/task/T-999`);
    await expect(page.getByTestId("error-panel")).toBeVisible();
    await expect(page.getByTestId("error-panel")).toContainText(
      "TC_TASK_NOT_FOUND",
    );

    // A malformed percent-encoded id must show the error panel, never a
    // crashed router stuck on the loading placeholder.
    await page.goto(`${baseUrl}/#/task/%E0%A4%A`);
    await expect(page.getByTestId("error-panel")).toBeVisible();
    await expect(page.getByTestId("error-panel")).toContainText(
      "TC_WATCH_BAD_ROUTE",
    );
  });

  test("runtime separates observations from task facts; stale and finished coexist", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/#/runtime`);

    await expect(page.getByTestId("runtime-view")).toBeVisible();
    await expect(page.getByTestId("observations")).toHaveClass(
      /panel-observation/,
    );
    await expect(page.getByTestId("task-facts")).toBeVisible();

    const rows = page.locator('[data-testid="observation-table"] tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Stale" })).toContainText(
      "run-T-308-1",
    );
    await expect(rows.filter({ hasText: "Finished" })).toContainText(
      "run-finished",
    );
    await expect(rows.filter({ hasText: "Finished" })).toContainText(
      "completed",
    );

    await expect(page.getByTestId("task-summary-table")).toContainText("T-308");
    await expect(page.getByTestId("task-summary-table")).toContainText(
      "host-1",
    );

    // A stale/finished observation does not flip the task status: T-502 is
    // still active on the board.
    await page.goto(`${baseUrl}/#/board`);
    await expect(
      page.locator('[data-task-id="T-502"] .status-tag.active'),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page, DESKTOP.width);
  });

  test("diagnostics aggregates anomalies", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${baseUrl}/#/diag`);

    await expect(page.getByTestId("diagnostics-view")).toBeVisible();
    await expect(
      page.locator('[data-code="TC_RETRIES_EXHAUSTED"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-code="TC_REQUIRED_EVIDENCE_MISSING"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-code="TC_OBSERVATION_STALE"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-code="TC_RETRIES_EXHAUSTED"]'),
    ).toContainText("Task T-107 exhausted its retries");
  });
});

test.describe("mobile smoke (390x844)", () => {
  test("board stacks single-column with reachable tabs and no overlap", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${baseUrl}/#/board`);
    await expect(page.getByTestId("board-view")).toBeVisible();

    // Groups stack vertically in one aligned column without overlapping.
    const boxes = await page
      .locator(".board-groups > .group")
      .evaluateAll((groups) =>
        groups.map((group) => {
          const rect = group.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            bottom: rect.bottom,
          };
        }),
      );

    expect(boxes.length).toBe(5);
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.width).toBeLessThanOrEqual(MOBILE.width);
    }
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index]!.x).toBe(boxes[0]!.x);
      expect(boxes[index]!.y).toBeGreaterThanOrEqual(
        boxes[index - 1]!.bottom - 1,
      );
    }

    // Tabs stay reachable and switch views.
    await page.locator('.tabs a[data-nav="runtime"]').click();
    await expect(page.getByTestId("runtime-view")).toBeVisible();
    await page.locator('.tabs a[data-nav="diag"]').click();
    await expect(page.getByTestId("diagnostics-view")).toBeVisible();
    await page.locator('.tabs a[data-nav="board"]').click();
    await expect(page.getByTestId("board-view")).toBeVisible();

    await expectNoHorizontalOverflow(page, MOBILE.width);
  });

  test("detail and waiting card reachable on mobile without overflow", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${baseUrl}/#/task/T-308`);

    await expect(page.getByTestId("detail-view")).toBeVisible();
    await expect(page.locator(".detail-head h1")).toContainText(
      "Stale host observation",
    );
    await expect(page.locator('[data-section="timeline"]')).toBeVisible();
    await expect(page.locator('[data-section="evidence"]')).toBeVisible();
    const specs = page.locator('[data-section="specs"]');
    await expect(specs).toBeVisible();
    await expect(specs).toContainText("engineering.watch-delivery");
    await expect(specs.getByTestId("spec-binding-table")).toBeVisible();
    await expectDetailSectionsDoNotOverlap(page);

    await page.goto(`${baseUrl}/#/board`);
    const waitingCard = page.locator('[data-task-id="T-503"]');
    await expect(waitingCard).toContainText(
      "Needs input — Schema decision needed",
    );
    await expect(waitingCard).toContainText("Responsible: User");
    await expect(waitingCard).toContainText("Recovery: None recorded");

    await expectNoHorizontalOverflow(page, MOBILE.width);
  });
});
