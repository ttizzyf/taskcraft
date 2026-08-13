// tc task list: projected task summaries (id/title/level/status/waiting
// reason/next), optional comma-separated --status filter and --json output.
// The status filter is validated at the boundary with the stable input error.

import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { parseJson, runCli, withInitializedDirectory } from "./helpers.js";

interface TaskListJson {
  ok: boolean;
  data: {
    tasks: Array<{
      taskId: string;
      title: string;
      level: number;
      status: string;
      taskRevision: number;
      waitingReason: string | null;
      next: string | null;
    }>;
  };
}

function newTask(cwd: string, title: string): void {
  const result = runCli(
    ["task", "new", "--title", title, "--level", "1", "--reason", "r"],
    cwd,
  );
  expect(result.status).toBe(0);
}

describe("tc task list", () => {
  it("lists no tasks before any exists", () => {
    withInitializedDirectory((cwd) => {
      const text = runCli(["task", "list"], cwd);
      expect(text.status).toBe(0);
      expect(text.stdout).toContain("No tasks");

      const json = parseJson<TaskListJson>(
        runCli(["task", "list", "--json"], cwd),
      );
      expect(json.data.tasks).toEqual([]);
    });
  });

  it("lists projected task summaries", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "First task");
      newTask(cwd, "Second task");
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const text = runCli(["task", "list"], cwd);
      expect(text.stdout).toContain("T-1");
      expect(text.stdout).toContain("active");
      expect(text.stdout).toContain("L1");
      expect(text.stdout).toContain("First task");
      expect(text.stdout).toContain("T-2");
      expect(text.stdout).toContain("queued");

      const json = parseJson<TaskListJson>(
        runCli(["task", "list", "--json"], cwd),
      );
      expect(json.data.tasks).toHaveLength(2);
      const first = json.data.tasks[0]!;
      expect(first).toMatchObject({
        taskId: "T-1",
        title: "First task",
        level: 1,
        status: "active",
        taskRevision: 2,
        waitingReason: null,
      });
      expect(first.next).toContain("tc run complete T-1");
    });
  });

  it("filters by a single status", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "Active task");
      newTask(cwd, "Queued task");
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const json = parseJson<TaskListJson>(
        runCli(["task", "list", "--status", "active", "--json"], cwd),
      );

      expect(json.data.tasks.map((task) => task.taskId)).toEqual(["T-1"]);
    });
  });

  it("filters by comma-separated statuses", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "Active task");
      newTask(cwd, "Queued task");
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const json = parseJson<TaskListJson>(
        runCli(["task", "list", "--status", "active,queued", "--json"], cwd),
      );

      expect(json.data.tasks).toHaveLength(2);
    });
  });

  it("shows the waiting reason for waiting tasks", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "Waiting task");
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);
      expect(
        runCli(
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
        ).status,
      ).toBe(0);

      const json = parseJson<TaskListJson>(
        runCli(["task", "list", "--status", "waiting", "--json"], cwd),
      );
      const waiting = json.data.tasks[0]!;

      expect(waiting.taskId).toBe("T-1");
      expect(waiting.status).toBe("waiting");
      expect(waiting.waitingReason).toBe("needs_input");
      expect(waiting.next).toContain("tc task resume T-1");
    });
  });

  it("rejects unknown statuses with the stable input error", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "Any task");

      const result = runCli(["task", "list", "--status", "bogus"], cwd);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(ERROR_CODES.TC_TASK_INPUT_INVALID);
      expect(result.stderr).toContain("active|waiting");
    });
  });
});
