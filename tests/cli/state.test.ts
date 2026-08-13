// tc state: --breadcrumb replays the silent entry gate (takeOver off, no
// task and non-active projections stay silent with exit 0; the unique active
// task prints exactly one breadcrumb line) and --json prints the full
// projected state as a command result.

import { describe, expect, it } from "vitest";

import { BREADCRUMB_SCHEMA_VERSION } from "../../src/core/breadcrumb.js";
import { parseJson, runCli, withInitializedDirectory } from "./helpers.js";

function newTask(cwd: string, title: string): void {
  const result = runCli(
    ["task", "new", "--title", title, "--level", "1", "--reason", "r"],
    cwd,
  );
  expect(result.status).toBe(0);
}

function enable(cwd: string, mode: string): void {
  expect(runCli(["enable", mode], cwd).status).toBe(0);
}

interface StateJson {
  ok: boolean;
  data: {
    currentTask: { taskId: string; status: string } | null;
    tasks: Array<{ taskId: string; status: string }>;
  };
}

describe("tc state --breadcrumb", () => {
  it("prints nothing when takeover is off", () => {
    withInitializedDirectory((cwd) => {
      enable(cwd, "off");
      const result = runCli(["state", "--breadcrumb"], cwd);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    });
  });

  it("prints nothing when no task exists", () => {
    withInitializedDirectory((cwd) => {
      enable(cwd, "always");
      const result = runCli(["state", "--breadcrumb"], cwd);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    });
  });

  it("prints nothing while the only task is not active", () => {
    withInitializedDirectory((cwd) => {
      enable(cwd, "always");
      newTask(cwd, "Queued task");
      const result = runCli(["state", "--breadcrumb"], cwd);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    });
  });

  it("prints exactly one breadcrumb line for the unique active task", () => {
    withInitializedDirectory((cwd) => {
      enable(cwd, "always");
      newTask(cwd, "Active task");
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const result = runCli(["state", "--breadcrumb"], cwd);

      expect(result.status).toBe(0);
      const lines = result.stdout.trim().split("\n");
      expect(lines).toHaveLength(1);
      const breadcrumb = JSON.parse(lines[0]!) as {
        schemaVersion: string;
        task: { id: string; status: string };
      };
      expect(breadcrumb.schemaVersion).toBe(BREADCRUMB_SCHEMA_VERSION);
      expect(breadcrumb.task.id).toBe("T-1");
      expect(breadcrumb.task.status).toBe("active");
    });
  });

  it("exits 1 with the stable adapter error when config.json is missing", () => {
    withInitializedDirectory((cwd) => {
      // init does not write config.json; takeOver defaults to off only after
      // `tc enable` — the missing config fails exactly like the old inline
      // gate (same runEntryGate error contract).
      const result = runCli(["state", "--breadcrumb"], cwd);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_ADAPTER_HOOK_INSTALL_FAILED");
    });
  });
});

describe("tc state --json and default view", () => {
  it("prints the full projected state before any task exists", () => {
    withInitializedDirectory((cwd) => {
      const json = parseJson<StateJson>(runCli(["state", "--json"], cwd));

      expect(json.ok).toBe(true);
      expect(json.data.currentTask).toBeNull();
      expect(json.data.tasks).toEqual([]);
    });
  });

  it("prints the full projected state for the unique active task", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "Active task");
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const json = parseJson<StateJson>(runCli(["state", "--json"], cwd));

      expect(json.data.currentTask?.taskId).toBe("T-1");
      expect(json.data.currentTask?.status).toBe("active");
    });
  });

  it("defaults to the same text view as tc status", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "Default view");

      const text = runCli(["state"], cwd);

      expect(text.status).toBe(0);
      expect(text.stdout).toContain("Status: queued");
      expect(text.stdout).toContain("Task: T-1");
    });
  });
});
