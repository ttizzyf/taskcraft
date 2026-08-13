// CLI tests for the waiting/resume/retry closed loop. Every runCli call is a
// separate spawned process (dist/cli.js), so the active -> waiting -> active
// -> done recovery across processes is exercised for real: process 1 opens
// the blocker, a fresh process answers the question and resumes.

import { describe, expect, it } from "vitest";

import { parseJson, runCli, withInitializedDirectory } from "./helpers.js";

const RESULT = JSON.stringify({
  summary: "done",
  evidence: [
    { type: "validation", reference: "tests/x.test.ts", summary: "passes" },
  ],
  record: { summary: "recorded" },
});

function setupTask(cwd: string): void {
  const created = runCli(
    ["task", "new", "--title", "Waiting task", "--level", "1", "--reason", "r"],
    cwd,
  );
  expect(created.status).toBe(0);
}

function attemptIdFromRun(stdout: string): string {
  const match = /Attempt: (att-\S+)/.exec(stdout);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe("tc task wait / resume closed loop", () => {
  it("completes active -> waiting -> active -> done across separate processes", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);

      // process 1: activate and open the blocker
      const run = runCli(["run", "T-1"], cwd);
      expect(run.status).toBe(0);
      const attemptId = attemptIdFromRun(run.stdout);

      const wait = runCli(
        [
          "task",
          "wait",
          "T-1",
          "--reason",
          "needs_input",
          "--message",
          "Which schema?",
        ],
        cwd,
      );
      expect(wait.status).toBe(0);
      expect(wait.stdout).toContain("Status: waiting");
      expect(wait.stdout).toContain("Waiting: needs_input");
      expect(wait.stdout).toContain("Next: tc task resume T-1");

      // a fresh process reads the persisted waiting state
      const fresh = runCli(["status"], cwd);
      expect(fresh.status).toBe(0);
      expect(fresh.stdout).toContain("Status: waiting");
      expect(fresh.stdout).toContain("Waiting: needs_input");

      // process 2: answer as a constraint fact, then resume
      const fact = runCli(
        [
          "task",
          "fact",
          "add",
          "T-1",
          "--attempt",
          attemptId,
          "--category",
          "constraint",
          "--subject",
          "schema",
          "--value",
          '{"decision":"v2"}',
        ],
        cwd,
      );
      expect(fact.status).toBe(0);

      const resume = runCli(["task", "resume", "T-1"], cwd);
      expect(resume.status).toBe(0);
      expect(resume.stdout).toContain("Status: active");
      expect(resume.stdout).toContain("Next: tc run T-1 --node execute-1");

      // the same fresh process continues the loop to done
      const claim = runCli(["run", "T-1", "--node", "execute-1"], cwd);
      expect(claim.status).toBe(0);
      expect(claim.stdout).toContain("Attempt: att-T-1-execute-1-2");

      const complete = runCli(
        ["run", "complete", "T-1", "--result", RESULT],
        cwd,
      );
      expect(complete.status).toBe(0);
      expect(complete.stdout).toContain("Status: done");

      const status = runCli(["status"], cwd);
      expect(status.stdout).toContain("Status: done");
      expect(status.stdout).toContain("Obligations: 3/3 required satisfied");
    });
  });

  it("resolves with --resolve without a satisfying fact", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);
      expect(
        runCli(
          [
            "task",
            "wait",
            "T-1",
            "--reason",
            "needs_decision",
            "--message",
            "Approve?",
          ],
          cwd,
        ).status,
      ).toBe(0);

      const resume = runCli(["task", "resume", "T-1", "--resolve"], cwd);
      expect(resume.status).toBe(0);
      expect(resume.stdout).toContain("Status: active");

      expect(runCli(["status"], cwd).stdout).toContain("Status: active");
    });
  });

  it("rejects an unanswered resume with TC_BLOCKER_UNRESOLVED and keeps waiting", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);
      expect(
        runCli(
          ["task", "wait", "T-1", "--reason", "needs_input", "--message", "m"],
          cwd,
        ).status,
      ).toBe(0);

      const resume = runCli(["task", "resume", "T-1"], cwd);

      expect(resume.status).toBe(1);
      expect(resume.stdout).toBe("");
      expect(resume.stderr).toContain("TC_BLOCKER_UNRESOLVED");
      expect(resume.stderr).toContain("impact:");
      expect(resume.stderr).toContain("remediation:");
      expect(runCli(["status"], cwd).stdout).toContain("Status: waiting");
    });
  });

  it("rejects a wait on a queued task with TC_TASK_NOT_ACTIVATED", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);

      const wait = runCli(
        ["task", "wait", "T-1", "--reason", "needs_input", "--message", "m"],
        cwd,
      );

      expect(wait.status).toBe(1);
      expect(wait.stderr).toContain("TC_TASK_NOT_ACTIVATED");
    });
  });

  it("outputs the tc-command-result/v1 shape with --json", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const result = parseJson<{
        ok: boolean;
        data: { status: string; waitingReason: string; next: string };
      }>(
        runCli(
          [
            "task",
            "wait",
            "T-1",
            "--reason",
            "needs_decision",
            "--message",
            "m",
            "--json",
          ],
          cwd,
        ),
      );
      expect(result.ok).toBe(true);
      expect(result.data.status).toBe("waiting");
      expect(result.data.waitingReason).toBe("needs_decision");
      expect(result.data.next).toBe("tc task resume T-1");
    });
  });
});

describe("tc run fail / retry", () => {
  it("creates a numbered successor attempt on retry", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const fail = runCli(
        [
          "run",
          "fail",
          "T-1",
          "--attempt",
          "att-T-1-execute-1-1",
          "--reason",
          "probe failed",
        ],
        cwd,
      );
      expect(fail.status).toBe(0);
      expect(fail.stdout).toContain("Status: active");

      const retry = runCli(
        [
          "run",
          "retry",
          "T-1",
          "--attempt",
          "att-T-1-execute-1-1",
          "--reason",
          "host died",
        ],
        cwd,
      );
      expect(retry.status).toBe(0);
      expect(retry.stdout).toContain("Successor attempt: att-T-1-execute-1-2");

      const claim = runCli(["run", "T-1"], cwd);
      expect(claim.status).toBe(0);
      expect(claim.stdout).toContain("Attempt: att-T-1-execute-1-2");
    });
  });

  it("exhausts the budget to waiting(failed_retries_exhausted) and blocks further retries", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const fail = runCli(
          [
            "run",
            "fail",
            "T-1",
            "--attempt",
            `att-T-1-execute-1-${attempt}`,
            "--reason",
            "flaky",
          ],
          cwd,
        );
        expect(fail.status).toBe(0);

        if (attempt < 3) {
          const retry = runCli(
            [
              "run",
              "retry",
              "T-1",
              "--attempt",
              `att-T-1-execute-1-${attempt}`,
              "--reason",
              "flaky",
            ],
            cwd,
          );
          expect(retry.status).toBe(0);
          expect(retry.stdout).toContain(
            `Successor attempt: att-T-1-execute-1-${attempt + 1}`,
          );
        }
      }

      const status = runCli(["status"], cwd);
      expect(status.stdout).toContain("Status: waiting");
      expect(status.stdout).toContain("Waiting: failed_retries_exhausted");

      const blockedRetry = runCli(
        [
          "run",
          "retry",
          "T-1",
          "--attempt",
          "att-T-1-execute-1-3",
          "--reason",
          "one more try",
        ],
        cwd,
      );
      expect(blockedRetry.status).toBe(1);
      expect(blockedRetry.stdout).toBe("");
      expect(blockedRetry.stderr).toContain("TC_RETRY_BUDGET_EXHAUSTED");

      // the human override: resume --resolve, claim attempt 4 and finish
      const resume = runCli(["task", "resume", "T-1", "--resolve"], cwd);
      expect(resume.status).toBe(0);
      expect(resume.stdout).toContain("Status: active");

      const claim = runCli(["run", "T-1", "--node", "execute-1"], cwd);
      expect(claim.status).toBe(0);
      expect(claim.stdout).toContain("Attempt: att-T-1-execute-1-4");

      expect(
        runCli(["run", "complete", "T-1", "--result", RESULT], cwd).status,
      ).toBe(0);
      expect(runCli(["status"], cwd).stdout).toContain("Status: done");
    });
  });

  it("rejects a fail on an unknown attempt with TC_ATTEMPT_REF_INVALID", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const fail = runCli(
        [
          "run",
          "fail",
          "T-1",
          "--attempt",
          "att-T-1-execute-1-99",
          "--reason",
          "x",
        ],
        cwd,
      );

      expect(fail.status).toBe(1);
      expect(fail.stderr).toContain("TC_ATTEMPT_REF_INVALID");
    });
  });
});
