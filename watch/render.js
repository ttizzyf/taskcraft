// Taskcraft Watch render helpers: pure data -> HTML string functions for
// Board, Runtime, Diagnostics and the error panel. No DOM access and no
// state: everything shown comes from the JSON API payload. Display labels
// are presentation mappings only (never a second state derivation).

const STATUS_LABEL = {
  active: "Active",
  waiting: "Waiting",
  queued: "Queued",
  done: "Done",
  cancelled: "Cancelled",
};

const WAITING_REASON_LABEL = {
  blocked_dependency: "Blocked dependency",
  needs_input: "Needs input",
  needs_decision: "Needs decision",
  failed_retries_exhausted: "Retries exhausted",
};

/** Who must act to unblock a waiting task (from the blocker kind). */
const BLOCKER_OWNER = {
  dependency: "Dependency",
  needs_input: "User",
  needs_decision: "User",
  evidence: "Agent",
  host: "Host",
  conflict: "Agent",
};

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

export function formatTime(iso) {
  if (iso === null || iso === undefined) {
    return "—";
  }

  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toISOString();
}

export function renderError(status, body) {
  const error = body?.error ?? {};
  const lines = [];

  if (error.problem) {
    lines.push(`<p>${escapeHtml(error.problem)}</p>`);
  }

  if (error.impact) {
    lines.push(`<p>Impact: ${escapeHtml(error.impact)}</p>`);
  }

  if (error.remediation) {
    lines.push(
      `<p>Recovery: <code>${escapeHtml(error.remediation)}</code></p>`,
    );
  }

  if (lines.length === 0) {
    lines.push(
      `<p>The watch API could not be reached (status ${escapeHtml(status)}).</p>`,
    );
  }

  const code = error.code ? `<code>${escapeHtml(error.code)}</code>` : "";
  return (
    `<div class="error-panel" role="alert" data-testid="error-panel">` +
    `<p class="error-title">${code || "Request failed"}</p>` +
    lines.join("") +
    `</div>`
  );
}

// --- board ----------------------------------------------------------------

function renderBlocker(waitingReason, blocker) {
  const reason = blocker.reason ? ` — ${escapeHtml(blocker.reason)}` : "";
  const owner = escapeHtml(BLOCKER_OWNER[blocker.kind] ?? blocker.kind);
  const recovery = blocker.remediationCommand
    ? `<code>${escapeHtml(blocker.remediationCommand)}</code>`
    : "None recorded";

  return (
    `<div class="card-blocker" data-testid="card-blocker">` +
    `<span>${escapeHtml(
      WAITING_REASON_LABEL[waitingReason] ?? "Blocked",
    )}${reason}</span>` +
    `<span>Responsible: ${owner}</span>` +
    `<span>Recovery: ${recovery}</span>` +
    `</div>`
  );
}

export function renderBoard(board) {
  const meta = `<p class="view-meta">Generated at ${escapeHtml(
    formatTime(board.generatedAt),
  )}</p>`;
  const groups = ["active", "waiting", "queued", "done", "cancelled"]
    .map((status) => renderGroup(status, board.groups[status] ?? []))
    .join("");

  return (
    `<section class="view-body board-view" data-testid="board-view">` +
    `<h2 class="view-title">Board</h2>` +
    meta +
    `<div class="board-groups">` +
    groups +
    `</div></section>`
  );
}

function renderGroup(status, cards) {
  const body =
    cards.length === 0
      ? `<p class="empty">None</p>`
      : cards.map(renderCard).join("");

  return (
    `<section class="group" data-status="${escapeHtml(status)}">` +
    `<h3><span>${escapeHtml(STATUS_LABEL[status] ?? status)}</span>` +
    `<span class="count">${cards.length}</span></h3>` +
    `<div class="group-body">${body}</div></section>`
  );
}

function renderCard(card) {
  const required =
    `${card.doneObligations}/${card.totalObligations}` +
    (card.totalObligations === 0 ? " (no required)" : "");
  const blocker =
    card.blocker === null
      ? ""
      : renderBlocker(card.waitingReason, card.blocker);
  const next = card.next
    ? `<div><dt>Next</dt><dd><code>${escapeHtml(card.next)}</code></dd></div>`
    : "";

  return (
    `<a class="card" href="#/task/${encodeURIComponent(card.id)}" ` +
    `data-task-id="${escapeHtml(card.id)}">` +
    `<div class="card-row"><span class="card-id">${escapeHtml(card.id)}</span>` +
    `<span class="badge level">L${card.level}</span>` +
    `<span class="status-tag ${escapeHtml(card.status)}">${escapeHtml(
      STATUS_LABEL[card.status] ?? card.status,
    )}</span></div>` +
    `<h4 class="card-title">${escapeHtml(card.title)}</h4>` +
    `<dl class="card-meta">` +
    `<div><dt>Node</dt><dd>${escapeHtml(card.node ?? "—")}</dd></div>` +
    `<div><dt>Required</dt><dd>${required}</dd></div>` +
    `<div><dt>Host</dt><dd>${escapeHtml(card.host ?? "—")}</dd></div>` +
    `<div><dt>Last act.</dt><dd>${escapeHtml(
      formatTime(card.lastActivity),
    )}</dd></div>` +
    next +
    `</dl>` +
    blocker +
    `</a>`
  );
}

// --- runtime ---------------------------------------------------------------

const OBSERVATION_LABEL = {
  pending: "Pending",
  running: "Running",
  stale: "Stale",
  finished: "Finished",
  failed: "Failed",
  unsupported: "Unsupported",
};

function renderObservationTable(runs) {
  const rows = runs
    .map(
      (run) =>
        `<tr data-run-id="${escapeHtml(run.id)}">` +
        `<td>${escapeHtml(run.id)}</td>` +
        `<td>${escapeHtml(run.taskId)}</td>` +
        `<td>${escapeHtml(run.host)}</td>` +
        `<td>${escapeHtml(run.hostRunId ?? "—")}</td>` +
        `<td>${escapeHtml(run.hostSessionId ?? "—")}</td>` +
        `<td>${escapeHtml(run.nodeAttemptId ?? "—")}</td>` +
        `<td><span class="status-tag ${escapeHtml(
          run.observationStatus,
        )}">${escapeHtml(
          OBSERVATION_LABEL[run.observationStatus] ?? run.observationStatus,
        )}</span></td>` +
        `<td>${escapeHtml(formatTime(run.lastSeenAt))}</td>` +
        `<td>${escapeHtml(run.finishReason ?? "—")}</td>` +
        `</tr>`,
    )
    .join("");

  return (
    `<div class="table-wrap"><table data-testid="observation-table">` +
    `<thead><tr><th>Run id</th><th>Task</th><th>Host</th><th>Run id (host)</th>` +
    `<th>Session (host)</th><th>Node attempt</th><th>Status</th>` +
    `<th>Last seen</th><th>Finish reason</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>`
  );
}

function renderTaskSummary(byTask) {
  const rows = byTask
    .map(
      (entry) =>
        `<tr data-task-summary="${escapeHtml(entry.taskId)}">` +
        `<td>${escapeHtml(entry.taskId)}</td>` +
        `<td>${entry.total}</td>` +
        `<td>${escapeHtml(entry.hosts.join(", "))}</td>` +
        `<td>${escapeHtml(formatTime(entry.lastSeenAt))}</td>` +
        `</tr>`,
    )
    .join("");

  return (
    `<div class="table-wrap"><table data-testid="task-summary-table">` +
    `<thead><tr><th>Task</th><th>Runs</th><th>Hosts</th><th>Last seen</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>`
  );
}

export function renderRuntime(runtime) {
  const emptyRuns =
    runtime.runs.length === 0
      ? `<p class="empty">No host observations recorded</p>`
      : renderObservationTable(runtime.runs);
  const emptySummary =
    runtime.byTask.length === 0
      ? `<p class="empty">No task run summaries</p>`
      : renderTaskSummary(runtime.byTask);

  return (
    `<section class="view-body runtime-view" data-testid="runtime-view">` +
    `<h2 class="view-title">Runtime</h2>` +
    `<p class="view-meta">Generated at ${escapeHtml(
      formatTime(runtime.generatedAt),
    )}</p>` +
    // Host observations and task-level facts are visually distinct layers:
    // observations carry the blue accent panel, facts the plain surface.
    `<section class="section panel-observation" data-testid="observations">` +
    `<div class="section-title">Host observations<span class="count">${
      runtime.runs.length
    }</span></div>` +
    `<div class="section-body">${emptyRuns}</div></section>` +
    `<section class="section" data-testid="task-facts">` +
    `<div class="section-title">Task facts<span class="count">${
      runtime.byTask.length
    }</span></div>` +
    `<div class="section-body">${emptySummary}</div></section>` +
    `</section>`
  );
}

// --- diagnostics ------------------------------------------------------------

function renderDiagnosticItem(item) {
  return (
    `<article class="section" data-code="${escapeHtml(item.code)}">` +
    `<div class="section-title"><code>${escapeHtml(item.code)}</code>` +
    `<span class="count">${escapeHtml(item.source)}</span></div>` +
    `<div class="section-body">` +
    `<p>${escapeHtml(item.problem)}</p>` +
    `<p>Impact: ${escapeHtml(item.impact)}</p>` +
    `<p>Recovery: <code>${escapeHtml(item.remediation)}</code></p>` +
    `</div></article>`
  );
}

export function renderDiagnostics(diagnostics) {
  const items =
    diagnostics.items.length === 0
      ? `<p class="empty" data-testid="diag-empty">No known issues</p>`
      : diagnostics.items.map(renderDiagnosticItem).join("");

  return (
    `<section class="view-body diagnostics-view" data-testid="diagnostics-view">` +
    `<h2 class="view-title">Diagnostics</h2>` +
    `<p class="view-meta">Generated at ${escapeHtml(
      formatTime(diagnostics.generatedAt),
    )}</p>` +
    items +
    `</section>`
  );
}
