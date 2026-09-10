/* global document */
import { escapeHtml } from "./guide.js";

function batchBadgeClass(status) {
  if (status === "running") return "badge-blocked";
  if (status === "pending") return "badge-neutral";
  if (status === "cancelled" || status === "canceled") {
    return "badge-inconclusive";
  }
  return "badge-neutral";
}

function countLabel(label, value) {
  return `<span class="batch-count"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</span>`;
}

function batchStatus(batch) {
  return batch.displayStatus || batch.status || "未知状态";
}

function batchCases(batch) {
  return batch.displayCases || (batch.caseIds || []).join("、") || "无案例";
}

function batchDiagnostics(batch) {
  return (
    batch.displayDiagnostics || (batch.diagnostics || []).join("；") || "无诊断"
  );
}

export function renderBatchSection(batches) {
  const empty = document.getElementById("batches-empty");
  const table = document.getElementById("batches-table-container");
  const cards = document.getElementById("batches-cards");
  const summary = document.getElementById("batches-summary");
  if (!empty || !table || !cards || !summary) return;

  const items = Array.isArray(batches) ? batches : [];
  summary.textContent =
    items.length > 0 ? `${items.length} 个批次` : "暂无批次";
  empty.hidden = items.length > 0;
  table.hidden = items.length === 0;
  cards.hidden = items.length === 0;

  const tbody = document.getElementById("batches-tbody");
  if (!tbody) return;
  tbody.innerHTML = items
    .map((batch) => {
      const status = batchStatus(batch);
      return `
        <tr>
          <td><strong>${escapeHtml(batch.id)}</strong></td>
          <td><span class="badge ${batchBadgeClass(batch.status)}">${escapeHtml(status)}</span></td>
          <td class="batch-cases">${escapeHtml(batchCases(batch))}</td>
          <td>${escapeHtml(batch.total)}</td>
          <td class="batch-pass">${escapeHtml(batch.pass)}</td>
          <td class="batch-fail">${escapeHtml(batch.fail)}</td>
          <td class="batch-inconclusive">${escapeHtml(batch.inconclusive)}</td>
          <td>${escapeHtml(batch.pending)}</td>
          <td>${escapeHtml(batch.running)}</td>
          <td>${escapeHtml(batch.displayCreatedAt || batch.createdAt)}</td>
          <td class="batch-diagnostics" title="${escapeHtml(batchDiagnostics(batch))}">${escapeHtml(batchDiagnostics(batch))}</td>
        </tr>
      `;
    })
    .join("");

  cards.innerHTML = items
    .map((batch) => {
      const status = batchStatus(batch);
      return `
        <article class="batch-card-mobile">
          <div class="batch-card-top">
            <strong>${escapeHtml(batch.id)}</strong>
            <span class="badge ${batchBadgeClass(batch.status)}">${escapeHtml(status)}</span>
          </div>
          <div class="batch-card-cases">${escapeHtml(batchCases(batch))}</div>
          <div class="batch-counts" aria-label="批次计数">
            ${countLabel("总数", batch.total)}
            ${countLabel("通过", batch.pass)}
            ${countLabel("未通过", batch.fail)}
            ${countLabel("无法判定", batch.inconclusive)}
            ${countLabel("待运行", batch.pending)}
            ${countLabel("运行中", batch.running)}
          </div>
          <div class="batch-card-meta">
            <span>创建：${escapeHtml(batch.displayCreatedAt || batch.createdAt)}</span>
            <span>诊断：${escapeHtml(batchDiagnostics(batch))}</span>
          </div>
        </article>
      `;
    })
    .join("");
}
