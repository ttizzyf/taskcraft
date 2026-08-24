import { escapeHtml } from "./render.js";

const DUTY_LABEL = {
  required: "Required",
  recommended: "Recommended",
};

export function renderSpecsBody(detail) {
  const specs = detail.specs;
  const issue =
    specs.registryIssue === null
      ? ""
      : `<p class="spec-issue"><strong>${escapeHtml(specs.registryIssue.code)}</strong> ${escapeHtml(specs.registryIssue.problem)}<br>${escapeHtml(specs.registryIssue.remediation)}</p>`;
  const bindings = specs.bindings
    .map(
      (binding) =>
        `<tr data-spec-binding="${escapeHtml(binding.id)}">` +
        `<td><code>${escapeHtml(binding.id)}</code></td>` +
        `<td>${escapeHtml(binding.kind)}</td>` +
        `<td><span class="badge ${escapeHtml(binding.duty)}">${escapeHtml(DUTY_LABEL[binding.duty] ?? binding.duty)}</span></td>` +
        `<td><code>${escapeHtml(binding.nodeId)}</code></td>` +
        `<td><code>${escapeHtml(binding.path)}</code></td>` +
        `<td><code class="digest">${escapeHtml(binding.digest)}</code></td>` +
        `<td><span class="status-tag ${escapeHtml(binding.drift.status)}">${escapeHtml(binding.drift.status)}</span>` +
        (binding.drift.reasons.length === 0
          ? ""
          : `<span class="spec-reasons">${escapeHtml(binding.drift.reasons.join(", "))}</span>`) +
        `</td></tr>`,
    )
    .join("");
  const bindingTable =
    bindings === ""
      ? `<p class="empty">No Specs bound to this lifecycle revision</p>`
      : `<div class="table-wrap"><table data-testid="spec-binding-table"><thead><tr>` +
        `<th>Spec</th><th>Kind</th><th>Duty</th><th>Node</th><th>Path</th><th>Digest</th><th>Drift</th>` +
        `</tr></thead><tbody>${bindings}</tbody></table></div>`;
  const impacts = specs.impacts
    .map(
      (impact) =>
        `<dl class="keyvals spec-impact" data-spec-impact="${escapeHtml(impact.result.outcome)}">` +
        `<div><dt>Outcome</dt><dd>${escapeHtml(impact.result.outcome)}</dd></div>` +
        `<div><dt>Record attempt</dt><dd><code>${escapeHtml(impact.recordAttemptId)}</code></dd></div>` +
        `<div><dt>Details</dt><dd>${escapeHtml(JSON.stringify(impact.result))}</dd></div>` +
        `</dl>`,
    )
    .join("");
  return (
    issue +
    bindingTable +
    `<div class="spec-impact-list">${impacts || `<p class="empty">No Spec Impact recorded</p>`}</div>`
  );
}
