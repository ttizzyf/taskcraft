import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CommandResultSuccess } from "../../src/core/command-result.js";
import { openDatabase } from "../../src/store/database.js";
import {
  parseJson,
  runCli,
  withInitializedDirectory,
  withTemporaryDirectory,
} from "./helpers.js";

interface TaskShowData {
  taskId: string;
  title: string;
  status: string;
  taskRevision: number;
  breadcrumb: { schemaVersion: string; next: { command: string } };
}

function newTask(cwd: string, title = "Fix typo"): void {
  const result = runCli(
    ["task", "new", "--title", title, "--level", "1", "--reason", "r"],
    cwd,
  );
  expect(result.status).toBe(0);
}

describe("tc task new", () => {
  it("creates a queued L1 card and returns the run command", () => {
    withInitializedDirectory((cwd) => {
      const result = runCli(
        [
          "task",
          "new",
          "--title",
          "Fix typo",
          "--level",
          "1",
          "--reason",
          "Local reversible text change",
        ],
        cwd,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Task: T-1");
      expect(result.stdout).toContain("Revision: 1");
      expect(result.stdout).toContain("Status: queued");
      expect(result.stdout).toContain("Next: tc run T-1");
    });
  });

  it("rejects level 2/3 with TC_TASK_LEVEL_UNSUPPORTED and exit 1", () => {
    withInitializedDirectory((cwd) => {
      for (const level of ["2", "3"]) {
        const result = runCli(
          ["task", "new", "--title", "L2", "--level", level, "--reason", "r"],
          cwd,
        );

        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("TC_TASK_LEVEL_UNSUPPORTED");
      }
    });
  });

  it("rejects a missing reason with a non-zero exit", () => {
    withInitializedDirectory((cwd) => {
      const result = runCli(
        ["task", "new", "--title", "X", "--level", "1"],
        cwd,
      );

      expect(result.status).toBe(1);
      expect(result.stderr.length).toBeGreaterThan(0);
    });
  });

  it("persists --facts as classification facts and round-trips them via task show", () => {
    withInitializedDirectory((cwd) => {
      const created = runCli(
        [
          "task",
          "new",
          "--title",
          "X",
          "--level",
          "1",
          "--reason",
          "r",
          "--facts",
          '{"domain":"docs","risk":"low"}',
        ],
        cwd,
      );

      expect(created.status).toBe(0);

      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      const row = database
        .prepare(
          "SELECT classification_facts_json AS facts FROM tasks WHERE id = ?",
        )
        .get("T-1") as { facts: string };
      database.close();
      expect(JSON.parse(row.facts)).toEqual({ domain: "docs", risk: "low" });
    });
  });

  it("rejects --facts that is not a JSON object with TC_TASK_INPUT_INVALID", () => {
    withInitializedDirectory((cwd) => {
      const result = runCli(
        [
          "task",
          "new",
          "--title",
          "X",
          "--level",
          "1",
          "--reason",
          "r",
          "--facts",
          "[1,2,3]",
        ],
        cwd,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("TC_TASK_INPUT_INVALID");
    });
  });
});

describe("tc task show", () => {
  it("renders the card; --json parses and matches the text fields", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd);
      const json = parseJson<CommandResultSuccess<TaskShowData>>(
        runCli(["task", "show", "T-1", "--json"], cwd),
      );

      expect(json.ok).toBe(true);
      expect(json.errors).toEqual([]);
      expect(json.data.taskId).toBe("T-1");
      expect(json.data.title).toBe("Fix typo");
      expect(json.data.status).toBe("queued");
      expect(json.data.taskRevision).toBe(1);
      expect(json.data.breadcrumb.schemaVersion).toBe("tc-breadcrumb/v1");

      const text = runCli(["task", "show", "T-1"], cwd).stdout;
      expect(text).toContain(`Task: ${json.data.taskId}`);
      expect(text).toContain(`Title: ${json.data.title}`);
      expect(text).toContain(`Status: ${json.data.status}`);
      expect(text).toContain(`Revision: ${json.data.taskRevision}`);
      expect(text).toContain(`Next: ${json.data.breadcrumb.next.command}`);
    });
  });

  it("fails with TC_TASK_NOT_FOUND for an unknown task", () => {
    withInitializedDirectory((cwd) => {
      const result = runCli(["task", "show", "T-99"], cwd);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_TASK_NOT_FOUND");
    });
  });
});

describe("tc task next", () => {
  it("reports the unique next command of a queued task", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd);
      const result = runCli(["task", "next", "T-1"], cwd);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Status: queued");
      expect(result.stdout).toContain("Next: tc run T-1");
      expect(result.stdout).toContain("execute-1  runnable");
      expect(result.stdout).toContain("record-1  blocked");
    });
  });
});

describe("tc task cancel", () => {
  it("cancels queued and active tasks; repeated cancel fails", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "First");
      newTask(cwd, "Second");
      const active = runCli(["run", "T-1"], cwd);
      expect(active.status).toBe(0);

      for (const taskId of ["T-1", "T-2"]) {
        const cancel = runCli(
          ["task", "cancel", taskId, "--reason", "superseded"],
          cwd,
        );
        expect(cancel.status).toBe(0);
        expect(cancel.stdout).toContain("Status: cancelled");
        expect(cancel.stdout).toContain(`Next: tc task show ${taskId}`);
      }

      const again = runCli(["task", "cancel", "T-1", "--reason", "again"], cwd);
      expect(again.status).toBe(1);
      expect(again.stderr).toContain("TC_TASK_ALREADY_CANCELLED");
    });
  });
});

describe("exit code contract", () => {
  it("returns 0 on success and 1 on business failures", () => {
    withTemporaryDirectory((cwd) => {
      runCli(["init"], cwd);

      expect(runCli(["status"], cwd).status).toBe(0);
      expect(runCli(["task", "next", "T-99"], cwd).status).toBe(1);
      expect(runCli(["run", "T-99"], cwd).status).toBe(1);
    });
  });
});
