// Task Detail view renderer: pure data -> HTML string. Everything shown is
// read from the /api/task/:id payload; independence is rendered as a plain
// text label without color emphasis (no exaggeration).

import { escapeHtml, formatTime } from "./render.js";
import { renderSpecsBody } from "./specs.js";

const NODE_SYMBOL = {
  satisfied: "✓",
  running: "▶",
  runnable: "○",
  blocked: "⊗",
};

const PURPOSE_LABEL = {
  feasibility: "Feasibility",
  delivery: "Delivery",
  integration: "Integration",
};

const INDEPENDENCE_LABEL = {
  "observed-distinct": "Observed distinct",
  unverified: "Unverified",
  "same-actor": "Same actor",
  unsupported: "Unsupported",
};

const DUTY_LABEL = {
  required: "Required",
  recommended: "Recommended",
  optional: "Optional",
};

/** Renders any JSON value (string, list or object) as readable HTML. */
function renderJson(value, fallback = "—") {
  if (value === null || value === undefined) {
    return `<p class="prose">${fallback}</p>`;
  }

  if (typeof value === "string") {
    return `<p class="prose">${escapeHtml(value)}</p>`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `<p class="prose">${fallback}</p>`;
    }

    return `<ul class="list">${value
      .map((item) => `<li>${renderInline(item)}</li>`)
      .join("")}</ul>`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `<p class="prose">${fallback}</p>`;
    }

    return `<dl class="keyvals">${entries
      .map(
        ([key, item]) =>
          `<div><dt>${escapeHtml(key)}</dt><dd>${renderInline(item)}</dd></div>`,
      )
      .join("")}</dl>`;
  }

  return `<p class="prose">${escapeHtml(value)}</p>`;
}

function renderInline(value) {
  if (typeof value === "object" && value !== null) {
    return escapeHtml(JSON.stringify(value));
  }
  return escapeHtml(value);
}

function section(title, body, count = "") {
  return (
    `<section class="section" data-section="${escapeHtml(title).toLowerCase()}">` +
    `<div class="section-title">${escapeHtml(title)}` +
    (count === "" ? "" : `<span class="count">${count}</span>`) +
    `</div><div class="section-body">${body}</div></section>`
  );
}

// --- header ----------------------------------------------------------------

function renderHeader(detail) {
  const task = detail.task;
  const waiting =
    task.waitingReason === null
      ? ""
      : `<span class="status-tag waiting">Waiting: ${escapeHtml(
          task.waitingReason,
        )}</span>`;

  return (
    `<header class="detail-head" data-testid="detail-head">` +
    `<div class="detail-eyebrow">` +
    `<span>${escapeHtml(task.id)}</span><span>·</span>` +
    `<span>Task revision ${task.taskRevision}</span><span>·</span>` +
    `<span>Lifecycle revision ${task.lifecycleRevision}</span><span>·</span>` +
    `<span>Created ${escapeHtml(formatTime(task.createdAt))}</span>` +
    `</div>` +
    `<h1>${escapeHtml(task.title)}</h1>` +
    `<div class="detail-summary">` +
    `<span class="badge level">L${task.level}</span>` +
    `<span class="status-tag ${escapeHtml(task.status)}">${escapeHtml(
      task.status,
    )}</span>` +
    waiting +
    `</div>` +
    `<div class="level-reason">` +
    `<p class="view-meta" style="margin:12px 0 4px"><strong>Level reason</strong></p>` +
    renderJson(task.classificationReasons, "No recorded reasons") +
    `</div>` +
    `</header>`
  );
}

// --- task card ---------------------------------------------------------------

function renderTaskCard(detail) {
  const { task } = detail;
  const objective = task.objective
    ? `<p class="prose">${escapeHtml(task.objective)}</p>`
    : `<p class="empty">No objective recorded</p>`;

  return section(
    "Task card",
    objective +
      `<p class="view-meta" style="margin:12px 0 4px"><strong>Scope</strong></p>` +
      renderJson(task.scope, "No scope recorded") +
      `<p class="view-meta" style="margin:12px 0 4px"><strong>Non-goals</strong></p>` +
      renderJson(task.nonGoals, "No non-goals recorded") +
      `<p class="view-meta" style="margin:12px 0 4px"><strong>Acceptance</strong></p>` +
      renderJson(task.acceptance, "No acceptance criteria recorded"),
  );
}

function renderChildren(detail) {
  const rows = (detail.projection.children ?? [])
    .map(
      (child) =>
        `<tr data-child-task="${escapeHtml(child.taskId)}">` +
        `<td><code>${escapeHtml(child.taskId)}</code></td>` +
        `<td>${escapeHtml(child.moduleKey)}</td>` +
        `<td>L${child.level}</td><td>${escapeHtml(child.requirementStatus)}</td>` +
        `<td>${escapeHtml(child.status)}</td>` +
        `<td><code>${escapeHtml(child.next ?? "—")}</code></td></tr>`,
    )
    .join("");
  const body =
    rows === ""
      ? `<p class="empty">No child tasks</p>`
      : `<div class="table-wrap"><table data-testid="children-table"><thead><tr>` +
        `<th>Task</th><th>Module</th><th>Level</th><th>Requirement</th><th>Status</th><th>Next</th>` +
        `</tr></thead><tbody>${rows}</tbody></table></div>`;
  return section("Children", body);
}

function renderAnchors(detail) {
  const rows = (detail.projection.anchors ?? [])
    .map((anchor) => {
      const children = (detail.projection.coverage ?? [])
        .filter((coverage) => coverage.anchorId === anchor.anchorId)
        .map((coverage) => coverage.childTaskId)
        .join(", ");
      return (
        `<tr data-anchor="${escapeHtml(anchor.anchorId)}">` +
        `<td><code>${escapeHtml(anchor.anchorId)}</code></td>` +
        `<td>${escapeHtml(anchor.text)}</td>` +
        `<td>${escapeHtml(anchor.disposition)}</td>` +
        `<td>${escapeHtml(children || "—")}</td></tr>`
      );
    })
    .join("");
  const body =
    rows === ""
      ? `<p class="empty">No acceptance anchors</p>`
      : `<div class="table-wrap"><table data-testid="anchors-table"><thead><tr>` +
        `<th>Anchor</th><th>Outcome</th><th>Disposition</th><th>Children</th>` +
        `</tr></thead><tbody>${rows}</tbody></table></div>`;
  return section("Acceptance anchors", body);
}

// --- lifecycle graph ----------------------------------------------------------

function renderGraph(detail) {
  const byId = new Map(
    (detail.projection.nodeStatuses ?? []).map((state) => [
      state.nodeId,
      state,
    ]),
  );
  const nodes = (detail.graph.nodes ?? [])
    .map((node) => {
      const state = byId.get(node.id) ?? { status: "blocked", attemptId: null };
      const symbol = NODE_SYMBOL[state.status] ?? "?";
      const attempt =
        state.attemptId === null
          ? ""
          : `<span class="node-attempt">${escapeHtml(state.attemptId)}</span>`;

      return (
        `<li data-node="${escapeHtml(node.id)}" data-node-status="${escapeHtml(
          state.status,
        )}">` +
        `<span class="node-symbol ${escapeHtml(state.status)}" aria-hidden="true">${symbol}</span>` +
        `<span class="node-kind">${escapeHtml(node.kind)}</span>` +
        `<span class="node-name">${escapeHtml(node.title)}</span>` +
        attempt +
        `</li>`
      );
    })
    .join("");

  const count = `${detail.projection.doneObligations}/${detail.projection.totalObligations} required done`;

  return section(
    "Lifecycle",
    `<ul class="node-list" data-testid="node-list">${nodes}</ul>`,
    count,
  );
}

// --- obligations --------------------------------------------------------------

function renderObligations(detail) {
  const resultById = new Map(
    (detail.obligationResults ?? []).map((result) => [
      result.obligationId,
      result,
    ]),
  );
  const rows = (detail.graph.obligations ?? [])
    .map((obligation) => {
      const result = resultById.get(obligation.id);
      const state = result === undefined ? "pending" : result.status;
      const evidence =
        result === undefined || result.satisfiedByEvidenceId === null
          ? "—"
          : `<code>${escapeHtml(result.satisfiedByEvidenceId)}</code>`;

      return (
        `<tr data-obligation="${escapeHtml(obligation.id)}">` +
        `<td>${escapeHtml(obligation.title)}</td>` +
        `<td><span class="badge ${escapeHtml(obligation.duty)}">${escapeHtml(
          DUTY_LABEL[obligation.duty] ?? obligation.duty,
        )}</span></td>` +
        `<td>${escapeHtml(state)}</td><td>${evidence}</td></tr>`
      );
    })
    .join("");

  const table =
    rows === ""
      ? `<p class="empty">No obligations defined</p>`
      : `<div class="table-wrap"><table data-testid="obligation-table"><thead><tr>` +
        `<th>Obligation</th><th>Duty</th><th>Status</th><th>Evidence</th>` +
        `</tr></thead><tbody>${rows}</tbody></table></div>`;

  return section("Obligations", table);
}

// --- evidence -----------------------------------------------------------------

function renderEvidence(detail) {
  const rows = (detail.evidence ?? [])
    .map(
      (item) =>
        `<tr data-evidence="${escapeHtml(item.id)}">` +
        `<td><code>${escapeHtml(item.id)}</code></td>` +
        `<td>${escapeHtml(item.type)}</td>` +
        `<td>${escapeHtml(item.summary)}</td>` +
        `<td><code>${escapeHtml(item.reference ?? "—")}</code></td>` +
        `<td>${escapeHtml(item.createdBy ?? "—")}</td></tr>`,
    )
    .join("");

  const table =
    rows === ""
      ? `<p class="empty">No evidence recorded</p>`
      : `<div class="table-wrap"><table data-testid="evidence-table"><thead><tr>` +
        `<th>Id</th><th>Type</th><th>Summary</th><th>Reference</th><th>Created by</th>` +
        `</tr></thead><tbody>${rows}</tbody></table></div>`;

  return section("Evidence", table);
}

// --- review -------------------------------------------------------------------

function renderReviewLinks(detail) {
  const rows = (detail.reviewLinks ?? [])
    .map((link) => {
      // Independence is a text label only: no color emphasis, so the viewer
      // reads the disclosure without visual bias.
      const independence = escapeHtml(
        INDEPENDENCE_LABEL[link.independenceStatus] ?? link.independenceStatus,
      );

      return (
        `<tr data-review-link="${escapeHtml(link.reviewAttemptId)}">` +
        `<td>${escapeHtml(PURPOSE_LABEL[link.reviewPurpose] ?? link.reviewPurpose)}</td>` +
        `<td><code>${escapeHtml(link.reviewedAttemptId)}</code></td>` +
        `<td>${escapeHtml(link.capability)}</td>` +
        `<td><span class="independence">${independence}</span></td></tr>`
      );
    })
    .join("");

  const table =
    rows === ""
      ? `<p class="empty">No review links recorded</p>`
      : `<div class="table-wrap"><table data-testid="review-table"><thead><tr>` +
        `<th>Purpose</th><th>Reviewed attempt</th><th>Capability</th><th>Independence</th>` +
        `</tr></thead><tbody>${rows}</tbody></table></div>`;

  return section("Review", table);
}

function renderFindings(detail) {
  const byReviewAttempt = new Map(
    (detail.reviewLinks ?? []).map((link) => [link.reviewAttemptId, link]),
  );
  const rows = (detail.findings ?? [])
    .map((finding) => {
      const link = byReviewAttempt.get(finding.reviewAttemptId);
      const reviewed = link?.reviewedAttemptId ?? "—";
      const purpose = link
        ? (PURPOSE_LABEL[link.reviewPurpose] ?? link.reviewPurpose)
        : "—";
      const independence = link
        ? (INDEPENDENCE_LABEL[link.independenceStatus] ??
          link.independenceStatus)
        : "—";

      return (
        `<tr data-finding="${escapeHtml(finding.id)}">` +
        `<td><code>${escapeHtml(finding.severity)}</code></td>` +
        `<td>${escapeHtml(finding.disposition)}</td>` +
        `<td>${escapeHtml(finding.summary)}</td>` +
        `<td><code>${escapeHtml(reviewed)}</code></td>` +
        `<td>${escapeHtml(purpose)}</td>` +
        `<td>${escapeHtml(link?.capability ?? "—")}</td>` +
        `<td>${escapeHtml(independence)}</td></tr>`
      );
    })
    .join("");

  const table =
    rows === ""
      ? `<p class="empty">No review findings</p>`
      : `<div class="table-wrap"><table data-testid="findings-table"><thead><tr>` +
        `<th>Severity</th><th>Disposition</th><th>Summary</th>` +
        `<th>Reviewed attempt</th><th>Purpose</th><th>Capability</th><th>Independence</th>` +
        `</tr></thead><tbody>${rows}</tbody></table></div>`;

  return section("Review findings", table);
}

// --- task facts ----------------------------------------------------------------

function renderTaskFacts(detail) {
  const facts = (detail.taskFacts ?? [])
    .map(
      (fact) =>
        `<dl class="keyvals" data-fact="${escapeHtml(fact.id)}">` +
        `<div><dt>Category</dt><dd>${escapeHtml(fact.category)}</dd></div>` +
        `<div><dt>Subject</dt><dd>${escapeHtml(fact.subject)}</dd></div>` +
        `<div><dt>Value</dt><dd>${renderInline(fact.value)}</dd></div>` +
        `<div><dt>Source attempt</dt><dd><code>${escapeHtml(fact.sourceAttemptId ?? "—")}</code></dd></div>` +
        `<div><dt>Created by</dt><dd>${escapeHtml(fact.createdBy ?? "—")}</dd></div>` +
        `</dl>`,
    )
    .join("");

  const body =
    facts.length === 0 ? `<p class="empty">No task facts</p>` : facts;

  return section("Task facts", body);
}

// --- timeline --------------------------------------------------------------------

function renderTimeline(detail) {
  const items = (detail.events ?? [])
    .map(
      (event) =>
        `<li data-event="${escapeHtml(event.eventType)}">` +
        `<strong>${escapeHtml(event.eventType)}</strong>` +
        `<span>seq ${event.taskSeq}` +
        `${event.nodeId ? ` · node ${escapeHtml(event.nodeId)}` : ""}` +
        `${event.attemptId ? ` · attempt ${escapeHtml(event.attemptId)}` : ""}` +
        ` · ${escapeHtml(formatTime(event.occurredAt))}</span></li>`,
    )
    .join("");

  const body =
    items === ""
      ? `<p class="empty">No events recorded</p>`
      : `<ol class="timeline" data-testid="timeline">${items}</ol>`;

  return section("Timeline", body);
}

// --- next command -----------------------------------------------------------------

function renderNext(detail) {
  const command = detail.next
    ? `<code class="command" data-testid="next-command">${escapeHtml(detail.next)}</code>`
    : `<p class="empty">No next command</p>`;

  return section("Next command", command);
}

// --- entry point -------------------------------------------------------------------

export function renderTaskDetail(detail) {
  return (
    `<section class="view-body detail-view" data-testid="detail-view" ` +
    `data-task-id="${escapeHtml(detail.task.id)}">` +
    renderHeader(detail) +
    `<div class="detail-grid">` +
    `<div class="detail-main">` +
    renderTaskCard(detail) +
    section("Specs", renderSpecsBody(detail)) +
    renderChildren(detail) +
    renderAnchors(detail) +
    renderGraph(detail) +
    renderObligations(detail) +
    `</div>` +
    `<aside class="detail-side">` +
    renderEvidence(detail) +
    renderReviewLinks(detail) +
    renderFindings(detail) +
    renderTaskFacts(detail) +
    renderTimeline(detail) +
    renderNext(detail) +
    `</aside>` +
    `</div></section>`
  );
}
