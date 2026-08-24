// tc run attach / run status public path: attach writes agent_runs through
// the reducer, run status renders attempts + observations from the same
// query model, and a finished observation never changes the task projection
// (the projector derives status from attempt facts only).

import { describe, expect, it } from "vitest";

import { parseJson, runCli, withInitializedDirectory } from "./helpers.js";

function setupActiveTask(cwd: string): void {
  const created = runCli(
    ["task", "new", "--title", "Runtime task", "--level", "1", "--reason", "r"],
    cwd,
  );
  expect(created.status).toBe(0);
  const claimed = runCli(
    ["run", "T-1", "--node", "execute-1", "--host", "codex"],
    cwd,
  );
  expect(claimed.status).toBe(0);
}

describe("tc run attach", () => {
  it("writes the observation and run status shows the same row", () => {
    withInitializedDirectory((cwd) => {
      setupActiveTask(cwd);
      const attach = runCli(
        [
          "run",
          "attach",
          "T-1",
          "--node",
          "execute-1",
          "--host-run-id",
          "hr-1",
          "--host-session-id",
          "s-1",
          "--host",
          "codex",
          "--status",
          "running",
        ],
        cwd,
      );

      expect(attach.status).toBe(0);
      expect(attach.stderr).toBe("");
      expect(attach.stdout).toContain("Task: T-1");
      expect(attach.stdout).toContain("Observation: ar-1 (running)");
      expect(attach.stdout).toContain("Node attempt: att-T-1-execute-1-1");

      const status = runCli(["run", "status", "T-1"], cwd);
      expect(status.status).toBe(0);
      expect(status.stderr).toBe("");
      expect(status.stdout).toContain("Status: active");
      expect(status.stdout).toContain(
        "att-T-1-execute-1-1  execute-1  attempt 1  created  host codex",
      );
      expect(status.stdout).toContain(
        "ar-1  att-T-1-execute-1-1  host codex  run id hr-1  session s-1  running",
      );
    });
  });

  it("a finished observation does not drive task completion", () => {
    withInitializedDirectory((cwd) => {
      setupActiveTask(cwd);
      const attach = runCli(
        [
          "run",
          "attach",
          "T-1",
          "--node",
          "execute-1",
          "--host-run-id",
          "hr-9",
          "--status",
          "finished",
        ],
        cwd,
      );
      expect(attach.status).toBe(0);

      const status = runCli(["status"], cwd);
      expect(status.stdout).toContain("Status: active");
      expect(status.stdout).toContain("Next: tc run complete T-1");

      // the task still completes through the attempt result path
      const complete = runCli(
        [
          "run",
          "complete",
          "T-1",
          "--result",
          JSON.stringify({
            summary: "done",
            evidence: [{ type: "validation", reference: "r", summary: "ok" }],
            record: {
              summary: "recorded",
              specImpact: {
                outcome: "none",
                reason: "No reusable rule changed",
              },
            },
          }),
        ],
        cwd,
      );
      expect(complete.status).toBe(0);
      expect(complete.stdout).toContain("Status: done");
    });
  });

  it("--json exposes the same row the text output renders", () => {
    withInitializedDirectory((cwd) => {
      setupActiveTask(cwd);
      const attach = parseJson<{
        ok: boolean;
        data: { runId: string; nodeAttemptId: string; status: string };
      }>(
        runCli(
          [
            "run",
            "attach",
            "T-1",
            "--node",
            "execute-1",
            "--host-run-id",
            "hr-2",
            "--json",
          ],
          cwd,
        ),
      );

      expect(attach.ok).toBe(true);
      expect(attach.data.runId).toBe("ar-1");
      expect(attach.data.nodeAttemptId).toBe("att-T-1-execute-1-1");
      expect(attach.data.status).toBe("active");

      const status = parseJson<{
        ok: boolean;
        data: {
          taskId: string;
          status: string;
          attempts: unknown[];
          runs: Array<{ runId: string; hostRunId: string | null }>;
        };
      }>(runCli(["run", "status", "T-1", "--json"], cwd));

      expect(status.ok).toBe(true);
      expect(status.data.taskId).toBe("T-1");
      expect(status.data.status).toBe("active");
      expect(status.data.attempts).toHaveLength(1);
      expect(status.data.runs[0]).toMatchObject({
        runId: "ar-1",
        hostRunId: "hr-2",
      });
    });
  });

  it("fails with TC_ATTEMPT_REF_INVALID when the node has no attempt", () => {
    withInitializedDirectory((cwd) => {
      const created = runCli(
        ["task", "new", "--title", "Queued", "--level", "1", "--reason", "r"],
        cwd,
      );
      expect(created.status).toBe(0);

      const result = runCli(
        ["run", "attach", "T-1", "--node", "execute-1", "--host-run-id", "hr"],
        cwd,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("TC_ATTEMPT_REF_INVALID");
      expect(result.stderr).toContain("impact:");
      expect(result.stderr).toContain("remediation:");
    });
  });

  it("fails without --host-run-id and for an unknown task", () => {
    withInitializedDirectory((cwd) => {
      setupActiveTask(cwd);
      const missing = runCli(
        ["run", "attach", "T-1", "--node", "execute-1"],
        cwd,
      );
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain("host-run-id");

      const unknown = runCli(
        ["run", "attach", "T-99", "--node", "execute-1", "--host-run-id", "hr"],
        cwd,
      );
      expect(unknown.status).toBe(1);
      expect(unknown.stderr).toContain("TC_TASK_NOT_FOUND");
    });
  });
});

describe("tc run status", () => {
  it("is read-only and fails with TC_TASK_NOT_FOUND for an unknown task", () => {
    withInitializedDirectory((cwd) => {
      const result = runCli(["run", "status", "T-99"], cwd);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("TC_TASK_NOT_FOUND");
      expect(result.stderr).toContain("tc task list");
    });
  });
});
