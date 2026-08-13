// Taskcraft Watch bootstrap: hash routing (#/board, #/task/<id>, #/runtime,
// #/diag), JSON API fetching and error rendering. Views render from the API
// payload only; there is no second state derivation and no write entry
// point. The hash keeps deep links stable across reloads.

/* global AbortController, clearTimeout, document, fetch, location, setTimeout, window */

import { renderTaskDetail } from "./detail.js";
import {
  renderBoard,
  renderDiagnostics,
  renderError,
  renderRuntime,
} from "./render.js";

const app = document.getElementById("app");
const FETCH_TIMEOUT_MS = 10_000;

/** Parses location.hash into a route; unknown routes render an error. */
function parseHash() {
  const hash = location.hash.slice(1) || "/board";

  if (hash === "/board" || hash === "/runtime" || hash === "/diag") {
    return { view: hash.slice(1), taskId: null };
  }

  const match = /^\/task\/([^/]+)$/.exec(hash);

  if (match !== null) {
    try {
      return { view: "task", taskId: decodeURIComponent(match[1] ?? "") };
    } catch {
      // Malformed percent-encoding (e.g. #/task/%E0%A4%A) must not crash the
      // router; fall through to the explicit unknown-route error panel.
      return { view: "unknown", taskId: match[1] ?? hash };
    }
  }

  return { view: "unknown", taskId: hash };
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(path, { signal: controller.signal });
    let body = null;

    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return { status: response.status, body };
  } catch (cause) {
    return {
      status: 0,
      body: {
        error: {
          code: "TC_WATCH_NETWORK",
          problem:
            cause instanceof Error && cause.name === "AbortError"
              ? `The watch API did not answer within ${FETCH_TIMEOUT_MS / 1000}s`
              : "The watch API is not reachable",
          impact: "The view cannot load any data",
          remediation: "Re-run: tc watch",
        },
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Renders an API error body (or network failure) into the view. */
function showError(status, body) {
  app.innerHTML = renderError(status, body);
}

function setActiveNav(view) {
  for (const link of document.querySelectorAll("[data-nav]")) {
    const active =
      view === "task" ? false : link.getAttribute("data-nav") === view;

    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

async function route() {
  const { view, taskId } = parseHash();
  setActiveNav(view);

  if (view === "unknown") {
    showError(404, {
      error: {
        code: "TC_WATCH_BAD_ROUTE",
        problem: `Unknown watch route: ${taskId}`,
        impact: "There is no view for this route",
        remediation: "Open the board at #/board",
      },
    });
    return;
  }

  app.innerHTML = `<p class="loading">Loading…</p>`;

  if (view === "board") {
    const { status, body } = await fetchJson("/api/board");
    app.innerHTML =
      status === 200 ? renderBoard(body) : renderError(status, body);
    return;
  }

  if (view === "task") {
    const { status, body } = await fetchJson(
      `/api/task/${encodeURIComponent(taskId)}`,
    );
    app.innerHTML =
      status === 200 ? renderTaskDetail(body) : renderError(status, body);
    return;
  }

  if (view === "runtime") {
    const { status, body } = await fetchJson("/api/runtime");
    app.innerHTML =
      status === 200 ? renderRuntime(body) : renderError(status, body);
    return;
  }

  const { status, body } = await fetchJson("/api/diagnostics");
  app.innerHTML =
    status === 200 ? renderDiagnostics(body) : renderError(status, body);
}

window.addEventListener("hashchange", () => {
  void route();
});

void route();
