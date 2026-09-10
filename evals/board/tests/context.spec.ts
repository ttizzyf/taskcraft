import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "playwright/test";

import { startBoardServer } from "../server.ts";

test("unrun scenarios expose full context and preserve reading state when polling changes data", async ({
  page,
}) => {
  const runDir = mkdtempSync(join(tmpdir(), "evals-context-"));
  const server = await startBoardServer({ port: 0, runDir });
  try {
    await page.clock.install();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(server.url);
    await expect(page.locator("#stat-unrun")).toHaveText("3");
    for (const [index, title, step] of [
      [1, "冷启动恢复", "没有旧聊天的新会话"],
      [2, "审查修复", "框架独立验收产物"],
    ] as const) {
      await page.locator("#scenarios-tbody tr").nth(index).click();
      await expect(page.locator("#drawer-title")).toContainText(title);
      await expect(page.locator("#run-drilldown-content")).toContainText(
        "尚未执行评测",
      );
      await page.locator('[data-disclosure="guide-task"] > summary').click();
      await page.locator('[data-disclosure="guide-steps"] > summary').click();
      await expect(
        page.locator('[data-disclosure="guide-steps"] .details-content'),
      ).toContainText(step);
      await page
        .locator('[data-disclosure="guide-criteria"] > summary')
        .click();
      await expect(page.locator(".guide-criteria > li")).toHaveCount(12);
      if (index === 1) await page.locator("#btn-close-drawer").click();
    }

    const body = page.locator(".drawer-body");
    await body.evaluate((element) => {
      element.scrollTop = 500;
    });
    const scrollBefore = await body.evaluate((element) => element.scrollTop);
    // A changed payload forces a real rerender while the user is reading.
    writeFileSync(join(runDir, "bad-report.json"), "{ invalid json");
    const refresh = page.waitForResponse((response) =>
      response.url().endsWith("/api/data"),
    );
    await page.clock.fastForward(3100);
    await refresh;
    await expect(page.locator("#malformed-message")).toContainText(
      "1 个异常报告",
    );
    await expect(
      page.locator('[data-disclosure="guide-criteria"]'),
    ).toHaveAttribute("open", "");
    await expect(
      page.locator('[data-disclosure="guide-steps"]'),
    ).toHaveAttribute("open", "");
    await expect(
      page.locator('[data-disclosure="guide-task"]'),
    ).not.toHaveAttribute("open");
    expect(await body.evaluate((element) => element.scrollTop)).toBe(
      scrollBefore,
    );
    await expect(page.locator(".check-item")).toHaveCount(0);
  } finally {
    await server.close();
    rmSync(runDir, { recursive: true, force: true });
  }
});
