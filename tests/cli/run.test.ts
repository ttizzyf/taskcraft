import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseJson, runCli, withInitializedDirectory } from "./helpers.js";

const RESULT_WITH_RECORD = JSON.stringify({
  summary: "typo fixed",
  evidence: [
    {
      type: "validation",
      reference: "tests/typo.test.ts",
      summary: "test passes",
    },
  ],
  record: { summary: "recorded" },
});

function setupTask(cwd: string): void {
  const created = runCli(
    ["task", "new", "--title", "Fix typo", "--level", "1", "--reason", "r"],
    cwd,
  );
  expect(created.status).toBe(0);
}

describe("tc run", () => {
  it("activates the task and outputs the Node Brief with the result schema", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      const result = runCli(["run", "T-1", "--node", "execute-1"], cwd);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Task: T-1");
      expect(result.stdout).toContain("Status: active");
      expect(result.stdout).toContain("Next: tc run complete T-1");
      expect(result.stdout).toContain("Node Brief");
      expect(result.stdout).toContain("Node: execute-1 (execute)");
      expect(result.stdout).toContain("Result schema:");
      expect(result.stdout).toContain('"evidence"');
      expect(result.stdout).toContain("Complete command: tc run complete T-1");
    });
  });

  it("fails with TC_TASK_NOT_FOUND for an unknown task", () => {
    withInitializedDirectory((cwd) => {
      const result = runCli(["run", "T-99"], cwd);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_TASK_NOT_FOUND");
    });
  });
});

describe("tc run complete", () => {
  it("runs the full L1 loop to done with --result @path", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      writeFileSync(join(cwd, "result.json"), RESULT_WITH_RECORD);
      const complete = runCli(
        ["run", "complete", "T-1", "--result", "@result.json"],
        cwd,
      );

      expect(complete.status).toBe(0);
      expect(complete.stdout).toContain("Status: done");

      const status = runCli(["status"], cwd);
      expect(status.stdout).toContain("Status: done");
      expect(status.stdout).toContain("Obligations: 3/3 required satisfied");
      expect(status.stdout).toContain("execute-1  satisfied");
      expect(status.stdout).toContain("record-1  satisfied");

      const show = parseJson<{
        ok: boolean;
        data: { status: string; attempts: unknown[]; evidence: unknown[] };
      }>(runCli(["task", "show", "T-1", "--json"], cwd));
      expect(show.data.status).toBe("done");
      expect(show.data.attempts).toHaveLength(2);
      expect(show.data.evidence).toHaveLength(2);
    });
  });

  it("accepts the result from stdin with @-", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const complete = runCli(
        ["run", "complete", "T-1", "--result", "@-"],
        cwd,
        RESULT_WITH_RECORD,
      );

      expect(complete.status).toBe(0);
      expect(complete.stdout).toContain("Status: done");
    });
  });

  it("rejects unparsable result JSON with TC_LIFECYCLE_RESULT_INVALID", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const result = runCli(
        ["run", "complete", "T-1", "--result", "not-json"],
        cwd,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("TC_LIFECYCLE_RESULT_INVALID");
      expect(result.stderr).toContain("impact:");
      expect(result.stderr).toContain("remediation:");
    });
  });

  it("rejects a result without validation evidence with TC_REQUIRED_OBLIGATION_MISSING", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const result = runCli(
        [
          "run",
          "complete",
          "T-1",
          "--result",
          JSON.stringify({
            summary: "done",
            evidence: [
              { type: "test", reference: "r", summary: "only a test" },
            ],
          }),
        ],
        cwd,
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_REQUIRED_OBLIGATION_MISSING");
    });
  });

  it("rejects a stale --expected-revision with TC_REVISION_CONFLICT", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const result = runCli(
        [
          "run",
          "complete",
          "T-1",
          "--result",
          RESULT_WITH_RECORD,
          "--expected-revision",
          "1",
        ],
        cwd,
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_REVISION_CONFLICT");
      expect(result.stderr).toContain("tc status --json");
    });
  });

  it("reaches done by claiming record-1 after a record-less execute result", () => {
    withInitializedDirectory((cwd) => {
      setupTask(cwd);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const recordLess = JSON.stringify({
        summary: "typo fixed",
        evidence: [{ type: "validation", reference: "r", summary: "ok" }],
      });
      const complete = runCli(
        ["run", "complete", "T-1", "--result", recordLess],
        cwd,
      );
      expect(complete.status).toBe(0);
      expect(complete.stdout).toContain("Status: active");

      const next = runCli(["status"], cwd);
      expect(next.stdout).toContain("Next: tc run T-1 --node record-1");

      const claim = runCli(["run", "T-1", "--node", "record-1"], cwd);
      expect(claim.status).toBe(0);
      expect(claim.stdout).toContain("Node: record-1 (record)");
      expect(claim.stdout).toContain(
        "Complete command: tc run complete T-1 --node record-1",
      );

      const finish = runCli(
        [
          "run",
          "complete",
          "T-1",
          "--node",
          "record-1",
          "--result",
          '{"summary":"recorded"}',
        ],
        cwd,
      );
      expect(finish.status).toBe(0);
      expect(finish.stdout).toContain("Status: done");

      const status = runCli(["status"], cwd);
      expect(status.stdout).toContain("Status: done");
      expect(status.stdout).toContain("Obligations: 3/3 required satisfied");
    });
  });
});
