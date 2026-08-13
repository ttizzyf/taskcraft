// Render pure-function tests: data -> DOM structure for the watch frontend.
// The functions live in watch/render.js and watch/detail.js (plain browser
// ES modules, no build step); these tests exercise them with synthetic API
// payloads shaped exactly like src/watch/routes.ts responses.

import { describe, expect, it } from "vitest";

import { renderTaskDetail } from "../../watch/detail.js";
import {
  escapeHtml,
  renderBoard,
  renderDiagnostics,
  renderError,
  renderRuntime,
} from "../../watch/render.js";
import type { TaskCard } from "../../src/watch/routes.js";
import { buildDetail } from "./frontend-detail-fixture.js";

const TIMESTAMP = "2026-08-11T00:00:00.000Z";

const BASE_CARD: TaskCard = {
  id: "T-1",
  title: "Demo task",
  level: 1,
  status: "active",
  waitingReason: null,
  node: "execute-1",
  nodeKind: "execute",
  doneObligations: 0,
  totalObligations: 3,
  host: "host-1",
  lastActivity: TIMESTAMP,
  next: "tc run complete T-1",
  blocker: null,
};

function card(overrides: Partial<TaskCard> = {}): TaskCard {
  return { ...BASE_CARD, ...overrides };
}

describe("renderBoard", () => {
  it("groups the five public statuses and shows counts and empty states", () => {
    const html = renderBoard({
      groups: {
        active: [card({ id: "T-1", title: "Active one" })],
        waiting: [card({ id: "T-2", title: "Waiting one", status: "waiting" })],
        queued: [],
        done: [card({ id: "T-4", title: "Done one", status: "done" })],
        cancelled: [],
      },
      generatedAt: TIMESTAMP,
    });

    for (const status of ["active", "waiting", "queued", "done", "cancelled"]) {
      expect(html).toContain(`data-status="${status}"`);
    }

    expect(html).toContain("T-1");
    expect(html).toContain("Active one");
    expect(html).toContain('data-task-id="T-1"');
    expect(html).toContain(`href="#/task/T-1"`);
    expect(html).toContain("0/3");
    expect(html).toContain("None"); // empty groups show an explicit empty state
    expect(html).toContain("Generated at");
  });

  it("renders the waiting trio: reason, responsible party and recovery", () => {
    const html = renderBoard({
      groups: {
        active: [],
        waiting: [
          card({
            id: "T-503",
            title: "Waiting task",
            status: "waiting",
            waitingReason: "needs_input",
            next: null,
            blocker: {
              kind: "needs_input",
              reason: "Schema decision needed",
              remediationCommand: null,
            },
          }),
        ],
        queued: [],
        done: [],
        cancelled: [],
      },
      generatedAt: TIMESTAMP,
    });

    expect(html).toContain("Needs input — Schema decision needed");
    expect(html).toContain("Responsible: User");
    expect(html).toContain("Recovery: None recorded");
  });

  it("maps blocker kinds to responsible parties and shows recovery commands", () => {
    const html = renderBoard({
      groups: {
        active: [],
        waiting: [
          card({
            id: "T-107",
            status: "waiting",
            waitingReason: "failed_retries_exhausted",
            next: "tc run T-107 --node execute-1",
            blocker: {
              kind: "evidence",
              reason: "Three consecutive failures exhausted the retry budget",
              remediationCommand: "tc run T-107 --node execute-1",
            },
          }),
        ],
        queued: [],
        done: [],
        cancelled: [],
      },
      generatedAt: TIMESTAMP,
    });

    expect(html).toContain("Retries exhausted — Three consecutive failures");
    expect(html).toContain("Responsible: Agent");
    expect(html).toContain(
      "Recovery: <code>tc run T-107 --node execute-1</code>",
    );
  });
});

describe("renderTaskDetail", () => {
  it("renders header, node symbols and obligations", () => {
    const html = renderTaskDetail(buildDetail());

    expect(html).toContain('data-testid="detail-view"');
    expect(html).toContain("Lifecycle revision 2");
    expect(html).toContain("Task revision 3");
    expect(html).toContain("L2");
    expect(html).toContain("Needs cross-module tracking");
    expect(html).toContain("Ship the demo");
    expect(html).toContain("Acceptance A");
    expect(html).toContain("No cloud sync");
    expect(html).toContain('data-node-status="satisfied"');
    expect(html).toContain('data-node-status="running"');
    expect(html).toContain('data-node-status="runnable"');
    expect(html).toContain('data-node-status="blocked"');
    expect(html).toContain("✓");
    expect(html).toContain("▶");
    expect(html).toContain("○");
    expect(html).toContain("⊗");
    expect(html).toContain("att-exec-1");
    expect(html).toContain("1/3 required done");
    expect(html).toContain('data-obligation="outcome"');
    expect(html).toContain("satisfied");
    expect(html).toContain('data-testid="next-command"');
    expect(html).toContain("tc run complete T-1");
  });

  it("renders independence and review details as plain text labels", () => {
    const html = renderTaskDetail(buildDetail());

    // The label is present and carries no color-emphasizing class or style.
    expect(html).toContain("Same actor");
    expect(html).toMatch(/<span class="independence">Same actor<\/span>/);
    expect(html).not.toMatch(/independence[^>]*(color|background|style)/);
    expect(html).toContain("context-only");
    expect(html).toContain("Delivery");
    expect(html).toContain('data-finding="find-1"');
    expect(html).toContain("<code>advisory</code>");
    expect(html).toContain("open");
    expect(html).toContain("Consider a fallback");
  });

  it("escapes task-controlled text", () => {
    const html = renderTaskDetail(buildDetail());

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Demo &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders the event timeline and task facts", () => {
    const html = renderTaskDetail(buildDetail());

    expect(html).toContain('data-testid="timeline"');
    expect(html).toContain("task.created");
    expect(html).toContain("attempt.started");
    expect(html).toContain("seq 2");
    expect(html).toContain('data-fact="fact-1"');
    expect(html).toContain("api-availability");
    expect(html).toContain("{&quot;ok&quot;:true}");
  });

  it("shows an explicit no-next-command state", () => {
    const html = renderTaskDetail(
      buildDetail({ next: null, task: { ...buildDetail().task, next: null } }),
    );

    expect(html).toContain("No next command");
  });
});

describe("renderRuntime", () => {
  it("lists stale and finished observations next to the per-task facts", () => {
    const html = renderRuntime({
      runs: [
        {
          id: "run-1",
          taskId: "T-308",
          nodeAttemptId: "att-1",
          host: "host-1",
          hostRunId: "hr-1",
          hostSessionId: "hs-1",
          observationStatus: "stale",
          lastSeenAt: TIMESTAMP,
          finishReason: null,
          observationJson: "{}",
        },
        {
          id: "run-2",
          taskId: "T-502",
          nodeAttemptId: "att-2",
          host: "claude",
          hostRunId: null,
          hostSessionId: null,
          observationStatus: "finished",
          lastSeenAt: TIMESTAMP,
          finishReason: "completed",
          observationJson: "{}",
        },
      ],
      byTask: [
        { taskId: "T-308", total: 1, hosts: ["host-1"], lastSeenAt: TIMESTAMP },
        { taskId: "T-502", total: 1, hosts: ["claude"], lastSeenAt: TIMESTAMP },
      ],
      hookTests: {
        claude: {
          testedAt: TIMESTAMP,
          version: "2.1.220",
          ok: true,
          enforced: true,
        },
      },
      generatedAt: TIMESTAMP,
    });

    expect(html).toContain('data-testid="observations"');
    expect(html).toContain('data-testid="task-facts"');
    expect(html).toContain('data-testid="hook-tests"');
    expect(html).toContain("panel-observation");
    expect(html).toContain('data-run-id="run-1"');
    expect(html).toContain('data-run-id="run-2"');
    expect(html).toContain(">Stale<");
    expect(html).toContain(">Finished<");
    expect(html).toContain("hr-1");
    expect(html).toContain("hs-1");
    expect(html).toContain("completed");
    expect(html).toContain('data-task-summary="T-308"');
    expect(html).toContain('data-hook-test-agent="claude"');
    expect(html).toContain("2.1.220");
  });

  it("shows explicit empty states", () => {
    const html = renderRuntime({
      runs: [],
      byTask: [],
      hookTests: {},
      generatedAt: TIMESTAMP,
    });

    expect(html).toContain("No host observations recorded");
    expect(html).toContain("No task run summaries");
    expect(html).toContain("No hook field tests recorded");
  });

  it("shows failed hook tests with their failure reason", () => {
    const html = renderRuntime({
      runs: [],
      byTask: [],
      hookTests: {
        codex: {
          testedAt: TIMESTAMP,
          version: "1.0.0",
          ok: false,
          enforced: false,
          failure: "entry injection missing",
        },
      },
      generatedAt: TIMESTAMP,
    });

    expect(html).toContain('data-hook-test-agent="codex"');
    expect(html).toContain("failed");
    expect(html).toContain("entry injection missing");
  });
});

describe("renderDiagnostics", () => {
  it("lists code, problem, impact and remediation per item", () => {
    const html = renderDiagnostics({
      items: [
        {
          code: "TC_RETRIES_EXHAUSTED",
          problem: "Task T-107 exhausted its retries and is waiting",
          impact: "No automatic retry remains for the task",
          remediation: "Intervene manually or replan the task",
          source: "task",
        },
      ],
      generatedAt: TIMESTAMP,
    });

    expect(html).toContain('data-code="TC_RETRIES_EXHAUSTED"');
    expect(html).toContain("Task T-107 exhausted its retries and is waiting");
    expect(html).toContain("No automatic retry remains for the task");
    expect(html).toContain("Intervene manually or replan the task");
    expect(html).toContain(">task<");
  });

  it("shows an explicit empty state", () => {
    const html = renderDiagnostics({ items: [], generatedAt: TIMESTAMP });

    expect(html).toContain('data-testid="diag-empty"');
    expect(html).toContain("No known issues");
  });
});

describe("renderError", () => {
  it("renders a structured API error without silence", () => {
    const html = renderError(404, {
      error: {
        code: "TC_TASK_NOT_FOUND",
        problem: "Task T-999 does not exist",
        impact: "The requested task cannot be shown",
        remediation: "List known tasks with: tc task list",
      },
    });

    expect(html).toContain('data-testid="error-panel"');
    expect(html).toContain("TC_TASK_NOT_FOUND");
    expect(html).toContain("Task T-999 does not exist");
    expect(html).toContain("List known tasks with: tc task list");
  });

  it("falls back to a plain message for network failures", () => {
    const html = renderError(0, null);

    expect(html).toContain("Request failed");
    expect(html).toContain("status 0");
  });
});

describe("escapeHtml", () => {
  it("escapes every special character", () => {
    expect(escapeHtml("<b>&\"'</b>")).toBe(
      "&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;",
    );
  });
});
