export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function list(items) {
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

export function preserveReadingState(body, view, render) {
  const sameView = body.dataset.view === view;
  const scrollTop = sameView ? body.scrollTop : 0;
  const disclosures = new Map(
    sameView
      ? Array.from(
          body.querySelectorAll("details[data-disclosure]"),
          (element) => [element.dataset.disclosure, element.open],
        )
      : [],
  );
  const activeElement = body.ownerDocument.activeElement;
  const focused = body.contains(activeElement)
    ? activeElement.closest("details")?.dataset.disclosure
    : null;
  render();
  body.dataset.view = view;
  body.querySelectorAll("details[data-disclosure]").forEach((element) => {
    if (disclosures.has(element.dataset.disclosure)) {
      element.open = disclosures.get(element.dataset.disclosure);
    }
    if (sameView && element.dataset.disclosure === focused) {
      element.querySelector("summary").focus({ preventScroll: true });
    }
  });
  body.scrollTop = scrollTop;
}

export function renderScenarioGuide(guide) {
  if (!guide) return "";
  const task = guide.task;
  return `
    <section class="drilldown-card scenario-guide" aria-label="场景背景与验收说明">
      <h3 class="card-heading">场景说明</h3>
      <p class="guide-execution">${escapeHtml(guide.execution)}</p>
      <p><strong>背景：</strong>${escapeHtml(guide.background)}</p>
      <p><strong>测 tc 的什么：</strong>${escapeHtml(guide.focus)}</p>
      <details data-disclosure="guide-task" open>
        <summary>具体任务与输入输出示例</summary>
        <div class="details-content">
          <p>${escapeHtml(task.description)}</p>
          <div class="guide-example">
            <div><strong>输入示例</strong><pre>${escapeHtml(task.exampleInput)}</pre></div>
            <div><strong>期望结果</strong><pre>${escapeHtml(task.exampleOutput)}</pre><p>张三合计 15，李四合计 20，共 3 条数据。</p></div>
          </div>
          <h4>完整任务要求</h4>
          <ul>${list(task.requirements)}</ul>
          <details data-disclosure="guide-vectors">
            <summary>框架实际使用的正常输入验收样例</summary>
            <div class="details-content guide-example">
              <div><strong>测试输入</strong><pre>${escapeHtml(task.testInput)}</pre></div>
              <div><strong>独立预期值</strong><pre>${escapeHtml(task.testOutput)}</pre></div>
            </div>
          </details>
        </div>
      </details>
      <details data-disclosure="guide-steps">
        <summary>怎么测 · 执行步骤与覆盖范围</summary>
        <div class="details-content">
          <ol>${list(guide.steps)}</ol>
          <p><strong>当前覆盖范围：</strong>${escapeHtml(guide.boundary)}</p>
        </div>
      </details>
      <details data-disclosure="guide-criteria">
        <summary>完整验收标准（${guide.criteria.length}项）· 检查什么、怎样通过</summary>
        <div class="details-content">
          <p>这些是同一个任务的多个验收标准，不是多个 task。自动检查为主，模型评审补充判断；全部必要检查通过才算通过，模型好评不能覆盖自动检查失败，证据不足则无法判定。</p>
          <ol class="guide-criteria">
            ${guide.criteria
              .map(
                (criterion) => `
              <li>
                <strong>${escapeHtml(criterion.title)}</strong>
                <span class="criterion-kind">${escapeHtml(criterion.category)}</span>
                <p><strong>通过标准：</strong>${escapeHtml(criterion.standard)}</p>
                <p><strong>怎么检查：</strong>${escapeHtml(criterion.method)}</p>
                <code class="check-id">${escapeHtml(criterion.id)}</code>
              </li>
            `,
              )
              .join("")}
          </ol>
        </div>
      </details>
      <p class="guide-note">以上为当前场景定义，未运行也可查看。历史运行请结合该次报告保存的任务要求与检查结果判断。</p>
    </section>
  `;
}

export function renderCheckItems(run, guide, badgeClass, comparisonClass) {
  return run.checks
    .map((check) => {
      const criterion = guide?.criteria.find((item) => item.id === check.id);
      const delta = (run.comparison.checkDeltas || []).find(
        (item) => item.id === check.id,
      );
      const deltaBadge =
        delta && (delta.status === "improved" || delta.status === "regressed")
          ? `<span class="comp-badge ${comparisonClass(delta.status)}">${escapeHtml(delta.displayText)}</span>`
          : "";
      const evidence =
        run.rawReport.checks.find((item) => item.id === check.id)?.evidence ||
        [];
      const category =
        criterion?.category ||
        (check.grader === "code" ? "程序自动检查" : "模型补充评审");
      return `
      <div class="check-item">
        <div class="check-item-top">
          <span class="check-name">${escapeHtml(criterion?.title || check.id)}</span>
          <span class="badge ${badgeClass(check.verdict)}">${escapeHtml(check.displayVerdict)}</span>${deltaBadge}
        </div>
        <div class="check-meta"><span>${escapeHtml(category)}</span><code class="check-id">${escapeHtml(check.id)}</code></div>
        <div class="check-reason">${escapeHtml(check.reason)}</div>
        <details data-disclosure="check-${escapeHtml(check.id)}">
          <summary>验收标准与本次证据</summary>
          <div class="details-content">
            ${criterion ? `<p><strong>通过标准（当前定义）：</strong>${escapeHtml(criterion.standard)}</p><p><strong>怎么检查：</strong>${escapeHtml(criterion.method)}</p>` : "<p>当前场景说明没有收录此项标准，请查看该次报告的原始观察。</p>"}
            <p><strong>本次原始观察：</strong>${escapeHtml(check.rawReason)}</p>
            <ul class="check-evidence">${evidence.length ? list(evidence) : "<li>该报告未保存逐项证据。</li>"}</ul>
          </div>
        </details>
      </div>
    `;
    })
    .join("");
}
