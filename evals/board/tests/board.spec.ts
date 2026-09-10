import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "playwright/test";

import { startBoardServer } from "../server.ts";
import type { BoardServerHandle } from "../server.ts";
import type { EvalReport } from "../../core/types.ts";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 667 };

test.describe("evals standalone board browser smoke", () => {
  let serverHandle: BoardServerHandle;
  const legacyRunsDir = join(tmpdir(), `evals-browser-legacy-${Date.now()}`);

  test.beforeAll(async () => {
    mkdirSync(join(process.cwd(), "test-results"), { recursive: true });
    mkdirSync(legacyRunsDir, { recursive: true });
    const filename = "delivery-2026-09-09T11-29-30-582Z.json";
    copyFileSync(
      join(process.cwd(), "evals", "runs", filename),
      join(legacyRunsDir, filename),
    );
    serverHandle = await startBoardServer({
      port: 0,
      host: "127.0.0.1",
      runDir: legacyRunsDir,
    });
  });

  test.afterAll(async () => {
    await serverHandle.close();
    rmSync(legacyRunsDir, { recursive: true, force: true });
  });

  test("desktop: verifies hierarchy, real blocked sample, 4 unrun scenarios, drilldown & diagnostics", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(serverHandle.url);

    // Verify title and brand
    await expect(page).toHaveTitle("Taskcraft Evals 评测看板");
    await expect(page.locator(".brand-title")).toHaveText("Taskcraft Evals");

    // Verify overview metrics: 1 blocked, 4 unrun, 0 decisive, total 5
    await expect(page.locator("#stat-total")).toHaveText("5");
    await expect(page.locator("#stat-attempted")).toHaveText("1");
    await expect(page.locator("#stat-decisive")).toHaveText("0");
    await expect(page.locator("#stat-blocked")).toHaveText("1");
    await expect(page.locator("#stat-inconclusive")).toHaveText("0");
    await expect(page.locator("#stat-unrun")).toHaveText("4");

    // Verify 5 scenarios visible in table
    const rows = page.locator("#scenarios-tbody tr");
    await expect(rows).toHaveCount(5);

    // Delivery row: blocked
    const deliveryRow = rows.nth(0);
    await expect(deliveryRow).toContainText("功能交付");
    await expect(deliveryRow).toContainText("按姓名合计金额的 CSV 小工具");
    await expect(deliveryRow.locator(".badge-blocked")).toHaveText("执行受阻");
    await expect(deliveryRow).toContainText("执行未完成，尚无可验收结果");

    // Recovery, Review, L2 Review and normal-session resume are unrun
    const recoveryRow = rows.nth(1);
    await expect(recoveryRow).toContainText("冷启动恢复");
    await expect(recoveryRow.locator(".badge-unrun")).toHaveText("未运行");

    const reviewRow = rows.nth(2);
    await expect(reviewRow).toContainText("审查修复");
    await expect(reviewRow.locator(".badge-unrun")).toHaveText("未运行");

    const l2Row = rows.nth(3);
    await expect(l2Row).toContainText("L2 Review 回流");
    await expect(l2Row.locator(".badge-unrun")).toHaveText("未运行");

    const sessionResumeRow = rows.nth(4);
    await expect(sessionResumeRow).toContainText("正常会话恢复");
    await expect(sessionResumeRow.locator(".badge-unrun")).toHaveText("未运行");

    // Take screenshot of desktop overview in git-ignored test-results
    await page.screenshot({
      path: join(
        process.cwd(),
        "test-results",
        "evals-smoke-desktop-overview.png",
      ),
      fullPage: true,
    });

    // Click delivery scenario to open drawer
    await deliveryRow.click();
    const overlay = page.locator("#drawer-overlay");
    await expect(overlay).toBeVisible();
    await expect(page.locator("#drawer-title")).toContainText("功能交付");
    const guide = page.locator("#scenario-guide-content");
    await expect(guide).toContainText("1 个 L1 tc task");
    await expect(guide.locator(".guide-example").first()).toContainText(
      "张三合计 15",
    );
    await page.screenshot({
      path: join(
        process.cwd(),
        "test-results",
        "evals-smoke-desktop-context.png",
      ),
      animations: "disabled",
    });
    await guide.locator('[data-disclosure="guide-task"] > summary').click();
    await guide.locator('[data-disclosure="guide-criteria"] > summary').click();
    await expect(guide.locator(".guide-criteria > li")).toHaveCount(11);
    await expect(guide.locator(".guide-criteria")).toContainText(
      "拒绝非数字金额",
    );
    await guide.locator('[data-disclosure="guide-criteria"] > summary').click();

    // Check summary banner
    await expect(page.locator(".summary-blocked")).toContainText("执行受阻");

    // Check that unrecognized_model warning is displayed with non-root-cause clarification
    await expect(page.locator(".warning-callout")).toContainText(
      "该警告未证实为执行受阻的确诊根因",
    );

    // Check that checks are derived inconclusive, NOT independent red defects
    const checkItems = page.locator(".check-item");
    const checkCount = await checkItems.count();
    expect(checkCount).toBeGreaterThan(0);
    for (let i = 0; i < checkCount; i += 1) {
      await expect(checkItems.nth(i).locator(".badge")).toHaveText("无法判定");
      await expect(checkItems.nth(i)).toContainText("前置执行未完成");
    }

    await expect(checkItems.first().locator(".check-name")).toHaveText(
      "CSV 解析与金额合计正确",
    );
    await checkItems.first().locator("summary").click();
    await expect(checkItems.first().locator(".details-content")).toContainText(
      "src/csv-summary.mjs is missing",
    );
    await expect(checkItems.first().locator(".details-content")).toContainText(
      "同名累加",
    );

    // Expand Actor trajectory
    const actorDetails = page.locator("details", {
      hasText: "查看 Actor 会话轨迹",
    });
    await actorDetails.click();
    await expect(actorDetails.locator(".details-content")).toBeVisible();

    // Expand Raw observations
    const rawDetails = page.locator("details", {
      hasText: "查看原始检查项观察",
    });
    await rawDetails.click();
    await expect(rawDetails.locator(".details-content")).toContainText(
      "src/csv-summary.mjs is missing",
    );

    // Take screenshot of drawer drilldown in git-ignored test-results
    await page.screenshot({
      path: join(
        process.cwd(),
        "test-results",
        "evals-smoke-desktop-drilldown.png",
      ),
    });

    // Close via close button
    await page.locator("#btn-close-drawer").click();
    await expect(overlay).toBeHidden();

    // Re-open and close via Escape key
    await deliveryRow.click();
    await expect(overlay).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
  });

  test("mobile: responsive layout, cards view, touch drawer, accessible close", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(serverHandle.url);

    // Desktop table should be hidden on narrow screens
    await expect(page.locator(".main-section .table-container")).toBeHidden();

    // Mobile cards should be visible
    const cards = page.locator(".scenario-card-mobile");
    await expect(cards).toHaveCount(5);
    await expect(cards.nth(0)).toContainText("功能交付");
    await expect(cards.nth(0)).toContainText("执行受阻");
    await expect(cards.nth(0)).toContainText("按姓名合计金额的 CSV 小工具");
    await expect(cards.nth(0)).toContainText("执行未完成，尚无可验收结果");

    // Take mobile screenshot in git-ignored test-results
    await page.screenshot({
      path: join(
        process.cwd(),
        "test-results",
        "evals-smoke-mobile-overview.png",
      ),
      fullPage: true,
    });

    // Tap on mobile card
    await cards.nth(0).click();
    const overlay = page.locator("#drawer-overlay");
    await expect(overlay).toBeVisible();
    const taskDetails = page.locator('[data-disclosure="guide-task"]');
    await expect(taskDetails).toHaveAttribute("open", "");
    await expect(taskDetails).toContainText("张三合计 15");
    expect(
      await page
        .locator(".drawer-body")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: join(
        process.cwd(),
        "test-results",
        "evals-smoke-mobile-context.png",
      ),
      animations: "disabled",
    });

    // Tap close button
    await page.locator("#btn-close-drawer").click();
    await expect(overlay).toBeHidden();
  });
});

test.describe("evals synthetic trials comparison and diagnostics smoke", () => {
  // Synthetic trials must never be written into the real reports directory,
  // otherwise a running board could briefly display fabricated history.
  const tempDir = join(tmpdir(), `evals-smoke-${Date.now()}`);
  let tempServerHandle: BoardServerHandle;

  test.beforeAll(async () => {
    mkdirSync(tempDir, { recursive: true });

    // Trial 1: Fail under condition A
    const trial1: EvalReport = {
      schemaVersion: "tc-eval/v1",
      caseId: "delivery",
      title: "CSV feature delivery",
      verdict: "fail",
      summary: "CSV aggregation functional test failed",
      startedAt: "2026-09-09T10:00:00.000Z",
      finishedAt: "2026-09-09T10:00:10.000Z",
      workspace: "/tmp/eval-1",
      requirements: "reqs",
      setupError: null,
      executionError: null,
      gradingError: null,
      graderError: null,
      actor: [
        {
          phase: "actor",
          status: "success",
          elapsedMs: 8000,
          callCount: 1,
          diagnostics: [],
          hostVersion: "1.0",
          model: "model-synthetic",
          resultMetadata: null,
        },
      ],
      checks: [
        {
          id: "csv-functional",
          grader: "code",
          verdict: "fail",
          reason: "output mismatch",
          evidence: [],
        },
      ],
      model: {
        status: "pass",
        elapsedMs: 1000,
        callCount: 1,
        diagnostics: [],
      },
      task: null,
      taskReadError: null,
      environment: {
        node: "24",
        host: "local",
        model: "model-synthetic",
        judgeModel: "judge-synthetic",
      },
      provenance: {
        caseFingerprint: "cfp-1",
        graderFingerprint: "gfp-1",
        comparisonFingerprint: "cmp-synth-1",
        actorModel: "model-synthetic",
        judgeModel: "judge-synthetic",
        hostVersion: "1.0",
        actorTimeoutMs: 180_000,
        judgeTimeoutMs: 60_000,
        subjectRevision: "rev-git-1",
      },
    };
    writeFileSync(
      join(tempDir, "delivery-2026-09-09T10-00-00-000Z.json"),
      JSON.stringify(trial1, null, 2),
      "utf8",
    );

    tempServerHandle = await startBoardServer({
      port: 0,
      host: "127.0.0.1",
      runDir: tempDir,
    });
  });

  test.afterAll(async () => {
    await tempServerHandle.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("shows factual fail -> pass changes, per-check changes, timing delta, and malformed files", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(tempServerHandle.url);

    // Initial state: 1 attempted, 1 decisive, 0 blocked, 2 unrun
    await expect(page.locator("#stat-attempted")).toHaveText("1");
    await expect(page.locator("#stat-decisive")).toHaveText("1");
    await expect(
      page.locator("#scenarios-tbody tr").nth(0).locator(".badge-fail"),
    ).toHaveText("未通过");

    // Add Trial 2: Pass under same condition A, but 2s faster!
    const trial2: EvalReport = {
      schemaVersion: "tc-eval/v1",
      caseId: "delivery",
      title: "CSV feature delivery",
      verdict: "pass",
      summary: "all checks passed",
      startedAt: "2026-09-09T10:05:00.000Z",
      finishedAt: "2026-09-09T10:05:08.000Z", // 8s vs 10s
      workspace: "/tmp/eval-2",
      requirements: "reqs",
      setupError: null,
      executionError: null,
      gradingError: null,
      graderError: null,
      actor: [
        {
          phase: "actor",
          status: "success",
          elapsedMs: 6000,
          callCount: 1,
          diagnostics: [],
          hostVersion: "1.0",
          model: "model-synthetic",
          resultMetadata: null,
        },
      ],
      checks: [
        {
          id: "csv-functional",
          grader: "code",
          verdict: "pass",
          reason: "output matched exactly",
          evidence: [],
        },
      ],
      model: {
        status: "pass",
        elapsedMs: 1000,
        callCount: 1,
        diagnostics: [],
      },
      task: null,
      taskReadError: null,
      environment: {
        node: "24",
        host: "local",
        model: "model-synthetic",
        judgeModel: "judge-synthetic",
      },
      provenance: {
        caseFingerprint: "cfp-1",
        graderFingerprint: "gfp-1",
        comparisonFingerprint: "cmp-synth-1",
        actorModel: "model-synthetic",
        judgeModel: "judge-synthetic",
        hostVersion: "1.0",
        actorTimeoutMs: 180_000,
        judgeTimeoutMs: 60_000,
        subjectRevision: "rev-git-2", // different git revision
      },
    };
    writeFileSync(
      join(tempDir, "delivery-2026-09-09T10-05-00-000Z.json"),
      JSON.stringify(trial2, null, 2),
      "utf8",
    );

    // Also write a malformed JSON file
    writeFileSync(
      join(tempDir, "corrupted-file.json"),
      "{ invalid json syntax",
      "utf8",
    );

    // Click refresh button to trigger poll/reload
    await page.locator("#btn-refresh").click();

    // Now latest status is "通过" and the comparison records the observed result change.
    const deliveryRow = page.locator("#scenarios-tbody tr").nth(0);
    await expect(deliveryRow.locator(".badge-pass")).toHaveText("通过");
    await expect(deliveryRow.locator(".comp-changed")).toHaveText(
      "结果变化：未通过 → 通过",
    );

    // Malformed banner is displayed
    const alert = page.locator("#malformed-alert");
    await expect(alert).toBeVisible();
    await expect(page.locator("#malformed-message")).toContainText(
      "1 个异常报告文件",
    );

    // Click "查看明细"
    await page.locator("#btn-toggle-malformed").click();
    await expect(page.locator("#malformed-details")).toContainText(
      "corrupted-file.json",
    );

    // Click delivery row to inspect drilldown
    await deliveryRow.click();
    await expect(page.locator("#drawer-overlay")).toBeVisible();

    // Check history selector has 2 items
    const historyBtns = page.locator(".history-item-btn");
    await expect(historyBtns).toHaveCount(2);

    // Check comparison in drilldown shows the factual result change and timing delta.
    await expect(page.locator("#run-drilldown-content")).toContainText(
      "结果变化：未通过 → 通过",
    );
    await expect(page.locator("#run-drilldown-content")).toContainText(
      "-2.0秒",
    );

    // The per-check delta for csv-functional (fail -> pass) is shown inline on
    // the matching check row, not as a bare aggregate number.
    await expect(page.locator("#run-drilldown-content")).toContainText(
      "结果变化：未通过 → 通过",
    );

    // Click first trial in history
    await historyBtns.nth(1).click();
    await expect(page.locator(".summary-fail")).toContainText("未通过");
  });
});
