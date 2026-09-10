/* global document, window, fetch, console, setInterval */
import {
  escapeHtml,
  renderCheckItems,
  renderScenarioGuide,
  preserveReadingState,
} from "./guide.js";
import { renderBatchSection } from "./batches.js";

// Taskcraft Evals Standalone Board Client
(function () {
  "use strict";

  let boardData = null;
  let activeScenarioId = null;
  let activeRunId = null;
  let isPolling = true;
  let lastFocusedElement = null;

  function getBadgeClass(verdict) {
    switch (verdict) {
      case "pass":
        return "badge-pass";
      case "fail":
        return "badge-fail";
      case "blocked":
        return "badge-blocked";
      case "inconclusive":
        return "badge-inconclusive";
      case "unrun":
      default:
        return "badge-unrun";
    }
  }

  function getCompBadgeClass(status) {
    const classes = {
      changed: "comp-changed",
      inconclusive: "comp-inconclusive",
      unchanged: "comp-unchanged",
    };
    return classes[status] || "comp-muted";
  }

  async function fetchBoardData() {
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      const changed = JSON.stringify(data) !== JSON.stringify(boardData);
      boardData = data;
      document.getElementById("polling-text").textContent = "自动刷新中";
      if (changed) renderBoard();
    } catch (error) {
      console.error("Failed to load evals data:", error);
      const pollingText = document.getElementById("polling-text");
      if (pollingText) {
        pollingText.textContent = "连接服务失败";
      }
    }
  }

  function renderBoard() {
    if (!boardData) return;

    // Render Overview Metrics
    document.getElementById("stat-total").textContent =
      boardData.overview.totalScenarios;
    document.getElementById("stat-attempted").textContent =
      boardData.overview.attemptedScenarios;
    document.getElementById("stat-decisive").textContent =
      boardData.overview.decisiveScenarios;
    document.getElementById("stat-blocked").textContent =
      boardData.overview.blockedScenarios;
    document.getElementById("stat-inconclusive").textContent =
      boardData.overview.inconclusiveScenarios;
    document.getElementById("stat-unrun").textContent =
      boardData.overview.unrunScenarios;

    renderBatchSection(boardData.batches || []);

    // Render Timestamp
    const updateEl = document.getElementById("update-timestamp");
    if (updateEl && boardData.overview.lastUpdated) {
      const timeStr = new Date(
        boardData.overview.lastUpdated,
      ).toLocaleTimeString("zh-CN");
      updateEl.textContent = `最后检测：${timeStr}`;
    }

    // Render Malformed Diagnostics
    const malformedAlert = document.getElementById("malformed-alert");
    const malformedDetails = document.getElementById("malformed-details");
    if (
      boardData.malformedDiagnostics &&
      boardData.malformedDiagnostics.length > 0
    ) {
      malformedAlert.style.display = "flex";
      document.getElementById("malformed-message").textContent =
        `检测到 ${boardData.malformedDiagnostics.length} 个异常报告文件（已安全忽略，不影响看板渲染）`;
      malformedDetails.innerHTML = boardData.malformedDiagnostics
        .map(
          (d) =>
            `<div>• <strong>${escapeHtml(d.filename)}</strong>: ${escapeHtml(d.error)}</div>`,
        )
        .join("");
    } else {
      malformedAlert.style.display = "none";
    }

    // Render Table Body (Desktop)
    const tbody = document.getElementById("scenarios-tbody");
    tbody.innerHTML = "";
    const cardsContainer = document.getElementById("scenarios-cards");
    cardsContainer.innerHTML = "";

    boardData.scenarios.forEach((scenario) => {
      // Desktop row
      const tr = document.createElement("tr");
      tr.setAttribute("tabindex", "0");
      tr.setAttribute("role", "button");
      tr.setAttribute(
        "aria-label",
        `查看场景 ${scenario.chineseTitle} 的详情与历史`,
      );
      tr.addEventListener("click", () => openDrawer(scenario.id));
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDrawer(scenario.id);
        }
      });

      const compClass = scenario.latestRun
        ? getCompBadgeClass(scenario.latestRun.comparison.status)
        : "comp-muted";

      tr.innerHTML = `
        <td>
          <div class="scenario-title-cell">${escapeHtml(scenario.chineseTitle)}</div>
          <div class="scenario-desc-cell">${escapeHtml(scenario.description)}</div>
        </td>
        <td>
          <span class="badge ${getBadgeClass(scenario.status)}">${escapeHtml(scenario.displayStatus)}</span>
        </td>
        <td>
          <div class="reason-cell" title="${escapeHtml(scenario.oneLineReason)}">
            ${escapeHtml(scenario.oneLineReason)}
          </div>
        </td>
        <td>
          <span class="comp-badge ${compClass}">
            ${escapeHtml(scenario.comparisonText)}
          </span>
        </td>
        <td>${escapeHtml(scenario.displayTime)}</td>
        <td>${escapeHtml(scenario.displayElapsed)}</td>
        <td class="th-actions">
          <button type="button" class="btn btn-secondary btn-sm" aria-label="查看 ${escapeHtml(scenario.chineseTitle)} 详情">
            查看详情
          </button>
        </td>
      `;
      tbody.appendChild(tr);

      // Mobile card
      const card = document.createElement("div");
      card.className = "scenario-card-mobile";
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");
      card.addEventListener("click", () => openDrawer(scenario.id));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDrawer(scenario.id);
        }
      });

      card.innerHTML = `
        <div class="card-mobile-top">
          <span class="card-mobile-title">${escapeHtml(scenario.chineseTitle)}</span>
          <span class="badge ${getBadgeClass(scenario.status)}">${escapeHtml(scenario.displayStatus)}</span>
        </div>
        <div class="card-mobile-body">
          <p class="scenario-mobile-description">${escapeHtml(scenario.description)}</p>
          <div><strong>结论：</strong>${escapeHtml(scenario.oneLineReason)}</div>
          <div><strong>比对：</strong><span class="comp-badge ${compClass}">${escapeHtml(scenario.comparisonText)}</span></div>
          <div><strong>耗时：</strong>${escapeHtml(scenario.displayElapsed)} (${escapeHtml(scenario.displayTime)})</div>
        </div>
      `;
      cardsContainer.appendChild(card);
    });

    // If drawer is currently open, refresh its content smoothly
    if (activeScenarioId) {
      renderDrawerContent();
    }
  }

  function openDrawer(scenarioId) {
    lastFocusedElement = document.activeElement;
    activeScenarioId = scenarioId;

    // Pick latest run by default if not set
    const scenarioReports = (boardData.reports || []).filter(
      (r) => r.caseId === scenarioId,
    );

    if (scenarioReports.length > 0) {
      activeRunId = scenarioReports[0].id;
    } else {
      activeRunId = null;
    }

    renderDrawerContent();

    const overlay = document.getElementById("drawer-overlay");
    overlay.style.display = "flex";
    const closeBtn = document.getElementById("btn-close-drawer");
    if (closeBtn) closeBtn.focus();
  }

  function closeDrawer() {
    activeScenarioId = null;
    activeRunId = null;
    const overlay = document.getElementById("drawer-overlay");
    overlay.style.display = "none";
    if (lastFocusedElement) {
      lastFocusedElement.focus();
    }
  }

  function renderDrawerContent() {
    preserveReadingState(
      document.querySelector(".drawer-body"),
      `${activeScenarioId}/${activeRunId}`,
      renderDrawerBody,
    );
  }

  function renderDrawerBody() {
    const scenario = boardData.scenarios.find((s) => s.id === activeScenarioId);
    if (!scenario) return;

    document.getElementById("drawer-title").textContent = scenario.chineseTitle;
    document.getElementById("drawer-subtitle").textContent =
      scenario.description;
    document.getElementById("scenario-guide-content").innerHTML =
      renderScenarioGuide(scenario.guide);

    const scenarioReports = (boardData.reports || []).filter(
      (r) => r.caseId === activeScenarioId,
    );

    const historyNav = document.getElementById("history-nav");
    historyNav.innerHTML = "";

    if (scenarioReports.length === 0) {
      historyNav.innerHTML = `<span class="comp-muted">尚无历史评测记录</span>`;
      document.getElementById("run-drilldown-content").innerHTML = `
        <div class="drilldown-card">
          <div class="summary-banner summary-inconclusive">
            <strong>未运行：</strong>该场景尚未执行评测。可通过 <code>pnpm eval --case ${escapeHtml(scenario.id)}</code> 启动评测。
          </div>
        </div>
      `;
      return;
    }

    // Build history buttons
    scenarioReports.forEach((rep) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `history-item-btn ${rep.id === activeRunId ? "active" : ""}`;
      btn.innerHTML = `
        <span class="history-item-time">${escapeHtml(rep.displayTime)}</span>
        <span class="badge ${getBadgeClass(rep.verdict)}">${escapeHtml(rep.displayVerdict)}</span>
      `;
      btn.addEventListener("click", () => {
        activeRunId = rep.id;
        renderDrawerContent();
      });
      historyNav.appendChild(btn);
    });

    const currentRun =
      scenarioReports.find((r) => r.id === activeRunId) || scenarioReports[0];
    if (!currentRun) return;

    renderRunDrilldown(currentRun, scenario.guide);
  }

  function renderRunDrilldown(run, guide) {
    const container = document.getElementById("run-drilldown-content");

    let bannerClass = "summary-inconclusive";
    if (run.isBlocked) bannerClass = "summary-blocked";
    else if (run.verdict === "pass") bannerClass = "summary-pass";
    else if (run.verdict === "fail") bannerClass = "summary-fail";

    const comp = run.comparison;
    let comparisonHtml;
    if (comp.status === "none") {
      comparisonHtml = `<div class="meta-item"><span class="meta-key">比对结果：</span><span class="meta-val comp-muted">首次运行，暂无可比历史</span></div>`;
    } else if (comp.status === "inconclusive") {
      comparisonHtml = `<div class="meta-item"><span class="meta-key">比对状态：</span><span class="meta-val comp-inconclusive">${escapeHtml(comp.displayText)}</span></div>`;
    } else {
      comparisonHtml = `
        <div class="meta-item">
          <span class="meta-key">相较前次：</span>
          <span class="meta-val"><strong class="${getCompBadgeClass(comp.status)}">${escapeHtml(comp.displayText)}</strong> (耗时变化: ${escapeHtml(comp.displayTimingDelta || "0秒")})</span>
        </div>
      `;
    }

    // Unrecognized model callout
    let warningCalloutHtml = "";
    const hasWarning = run.actorSessions.some(
      (s) => s.hasUnrecognizedModelWarning,
    );
    if (hasWarning) {
      warningCalloutHtml = `
        <div class="warning-callout">
          <strong>诊断说明：</strong>宿主日志中出现了 <code>unrecognized_model</code> 警告。Taskcraft 评测规范明确：该警告未证实为执行受阻的确诊根因，不能单凭此项下结论。前置受阻事实已如实记录。
        </div>
      `;
    }
    const checksHtml = renderCheckItems(
      run,
      guide,
      getBadgeClass,
      getCompBadgeClass,
    );
    // Render actor sessions
    const actorHtml = run.actorSessions
      .map((s) => {
        return `
          <div style="margin-bottom: 8px; border-bottom: 1px dashed var(--border-subtle); padding-bottom: 6px;">
            <div><strong>${escapeHtml(s.phase)}</strong>: <span class="badge ${s.status === "success" ? "badge-pass" : "badge-fail"}">${escapeHtml(s.displayStatus)}</span> 耗时 ${escapeHtml(s.displayElapsed)}</div>
            ${
              s.diagnostics && s.diagnostics.length > 0
                ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(s.diagnostics.join("; "))}</div>`
                : ""
            }
          </div>
        `;
      })
      .join("");

    container.innerHTML = `
      <div class="drilldown-card">
        <div class="summary-banner ${bannerClass}">
          <strong>${escapeHtml(run.displayVerdict)}：</strong>${escapeHtml(run.oneLineReason)}
        </div>
        ${warningCalloutHtml}
        <div class="meta-grid">
          <div class="meta-item"><span class="meta-key">运行时间：</span><span class="meta-val">${escapeHtml(run.displayTime)}</span></div>
          <div class="meta-item"><span class="meta-key">总耗时：</span><span class="meta-val">${escapeHtml(run.displayElapsed)}</span></div>
          <div class="meta-item"><span class="meta-key">被测 Actor 模型：</span><span class="meta-val">${escapeHtml(run.conditionsDisplay.actorModel)}</span></div>
          <div class="meta-item"><span class="meta-key">Judge 评审模型：</span><span class="meta-val">${escapeHtml(run.conditionsDisplay.judgeModel)}</span></div>
          <div class="meta-item"><span class="meta-key">Actor 预算：</span><span class="meta-val">${escapeHtml(run.conditionsDisplay.actorTimeout)}</span></div>
          <div class="meta-item"><span class="meta-key">Judge 预算：</span><span class="meta-val">${escapeHtml(run.conditionsDisplay.judgeTimeout)}</span></div>
          <div class="meta-item"><span class="meta-key">Taskcraft Git 版本：</span><span class="meta-val">${escapeHtml(run.conditionsDisplay.subjectRevision)}</span></div>
          ${comparisonHtml}
        </div>
      </div>
      <div class="drilldown-card">
        <div class="card-heading">
          <span>本次检查结果 (${run.checks.length}项)</span>
        </div>
        <p class="guide-note">这是本报告实际生成的检查结果，条数不一定等于完整验收标准数。执行受阻或前置缺失时可能没有生成部分结果；未生成不代表通过。</p>
        ${run.isBlocked ? '<p class="check-derived-badge">本次执行未完成，以下检查无法判定，不计为多个独立功能缺陷。</p>' : ""}
        <div class="checks-list">
          ${checksHtml}
        </div>
      </div>
      <div class="drilldown-card">
        <div class="card-heading">
          <span>详细依据与运行轨迹</span>
        </div>
        <details data-disclosure="run-requirements">
          <summary>该次运行保存的原始任务要求</summary>
          <div class="details-content"><pre class="raw-json-box">${escapeHtml(run.rawReport.requirements || "该报告未保存任务要求。")}</pre></div>
        </details>
        <details data-disclosure="actor">
          <summary>查看 Actor 会话轨迹 (${run.actorSessions.length}次轮次)</summary>
          <div class="details-content">
            ${actorHtml || "<div>无 Actor 轨迹记录</div>"}
          </div>
        </details>

        <details data-disclosure="observations">
          <summary>查看原始检查项观察 (Raw Observations)</summary>
          <div class="details-content">
            ${run.checks
              .map(
                (c) =>
                  `<div style="margin-bottom: 6px;"><strong>${escapeHtml(c.id)}</strong>: ${escapeHtml(c.rawReason)}</div>`,
              )
              .join("")}
          </div>
        </details>

        <details data-disclosure="raw-report">
          <summary>查看完整原始 JSON 报告</summary>
          <div class="details-content">
            <pre class="raw-json-box"><code>${escapeHtml(JSON.stringify(run.rawReport, null, 2))}</code></pre>
          </div>
        </details>
      </div>
    `;
  }

  // Setup Event Listeners
  document.getElementById("btn-refresh").addEventListener("click", () => {
    fetchBoardData();
  });

  document.getElementById("btn-close-drawer").addEventListener("click", () => {
    closeDrawer();
  });

  document.getElementById("drawer-overlay").addEventListener("click", (e) => {
    if (e.target.id === "drawer-overlay") {
      closeDrawer();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeScenarioId) {
      closeDrawer();
    }
  });

  document
    .getElementById("btn-toggle-malformed")
    .addEventListener("click", () => {
      const details = document.getElementById("malformed-details");
      if (details.style.display === "none") {
        details.style.display = "block";
      } else {
        details.style.display = "none";
      }
    });

  // Initial Fetch & Polling
  fetchBoardData();
  setInterval(() => {
    if (isPolling) {
      fetchBoardData();
    }
  }, 3000);
})();
