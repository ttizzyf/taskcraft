import { describe, expect, it } from "vitest";

import { createContractValidators } from "../../src/contracts/schemas.js";
import { parseJson, runCli, withInitializedDirectory } from "./helpers.js";

interface StatusData {
  currentTask: {
    taskId: string;
    status: string;
    breadcrumb: unknown;
  } | null;
  tasks: Array<{ taskId: string; status: string; next: string | null }>;
}

function newTask(cwd: string, title: string): void {
  const result = runCli(
    ["task", "new", "--title", title, "--level", "1", "--reason", "r"],
    cwd,
  );
  expect(result.status).toBe(0);
}

describe("tc status", () => {
  it("shows an empty state before any task exists", () => {
    withInitializedDirectory((cwd) => {
      const text = runCli(["status"], cwd);
      expect(text.status).toBe(0);
      expect(text.stdout).toContain("No tasks yet");

      const json = parseJson<{
        ok: boolean;
        data: StatusData;
      }>(runCli(["status", "--json"], cwd));
      expect(json.data.tasks).toEqual([]);
      expect(json.data.currentTask).toBeNull();
    });
  });

  it("shows the single task detail with a schema-valid breadcrumb", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "Fix typo");
      const text = runCli(["status"], cwd);

      expect(text.stdout).toContain("Status: queued");
      expect(text.stdout).toContain("Task: T-1");
      expect(text.stdout).toContain("Next: tc run T-1");
      expect(text.stdout).toContain("Obligations: 0/4 required satisfied");
      expect(text.stdout).toContain("Nodes:");
      expect(text.stdout).toContain("execute-1  runnable");
      expect(text.stdout).toContain("Breadcrumb:");

      const json = parseJson<{
        ok: boolean;
        data: StatusData;
      }>(runCli(["status", "--json"], cwd));
      expect(json.data.currentTask?.taskId).toBe("T-1");
      const { breadcrumb } = createContractValidators();
      expect(breadcrumb(json.data.currentTask?.breadcrumb)).toBe(true);
    });
  });

  it("focuses on the unique active task while listing the others", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "First");
      newTask(cwd, "Second");
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const text = runCli(["status"], cwd);
      expect(text.stdout).toContain("Status: active");
      expect(text.stdout).toContain("Task: T-1");
      expect(text.stdout).toContain("Next: tc run complete T-1");

      const json = parseJson<{
        ok: boolean;
        data: StatusData;
      }>(runCli(["status", "--json"], cwd));
      expect(json.data.currentTask?.taskId).toBe("T-1");
      expect(json.data.tasks).toHaveLength(2);
    });
  });

  it("lists every task when there is no unique current task", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "First");
      newTask(cwd, "Second");

      const text = runCli(["status"], cwd);
      expect(text.stdout).toContain("Tasks:");
      expect(text.stdout).toContain("T-1  queued");
      expect(text.stdout).toContain("T-2  queued");
    });
  });
});

describe("tc root command", () => {
  it("prints the unique active task next without a task id", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "First");
      newTask(cwd, "Second");
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const root = runCli([], cwd);
      expect(root.status).toBe(0);
      expect(root.stdout).toContain("Task: T-1");
      expect(root.stdout).toContain("Next: tc run complete T-1");
    });
  });

  it("lists tasks when multiple are active", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "First");
      newTask(cwd, "Second");
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);
      expect(runCli(["run", "T-2"], cwd).status).toBe(0);

      const root = runCli([], cwd);
      expect(root.status).toBe(0);
      expect(root.stdout).toContain("Tasks:");
      expect(root.stdout).toContain("T-1  active");
      expect(root.stdout).toContain("T-2  active");
    });
  });
});
