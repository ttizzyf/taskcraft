// Installed entry wrapper (entry.sh -> tc state --breadcrumb) behaves
// exactly like the old inline gate (node dist/hooks/entry.js): takeOver off,
// no task and non-active projections stay silent with exit 0; the unique
// active task prints exactly one breadcrumb line. The wrapper is the real
// production template (entryHookTemplate) spawned through bash, and the
// project root is derived from the script location, so the spawn cwd is
// intentionally different from the project (cwd-independence proof).

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { entryHookTemplate } from "../../src/adapters/shared.js";
import { BREADCRUMB_SCHEMA_VERSION } from "../../src/core/breadcrumb.js";
import { CLI_PATH, runCli, withTemporaryDirectory } from "./helpers.js";

interface EntryResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function installEntryWrapper(cwd: string): string {
  const hooksDir = join(cwd, ".taskcraft", "hooks");
  const entryPath = join(hooksDir, "entry.sh");

  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(entryPath, entryHookTemplate(CLI_PATH), { mode: 0o755 });

  return entryPath;
}

function runEntryWrapper(entryPath: string): EntryResult {
  // No cwd: the wrapper must resolve the project root itself.
  const result = spawnSync("bash", [entryPath], { encoding: "utf8" });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("installed entry wrapper equivalence", () => {
  it("stays silent when takeover is off", () => {
    withTemporaryDirectory((cwd) => {
      const entryPath = installEntryWrapper(cwd);
      expect(runCli(["enable", "off"], cwd).status).toBe(0);

      const result = runEntryWrapper(entryPath);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });
  });

  it("stays silent when no task exists", () => {
    withTemporaryDirectory((cwd) => {
      const entryPath = installEntryWrapper(cwd);
      expect(runCli(["init"], cwd).status).toBe(0);
      expect(runCli(["enable", "always"], cwd).status).toBe(0);

      const result = runEntryWrapper(entryPath);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });
  });

  it("stays silent while the only task is not active", () => {
    withTemporaryDirectory((cwd) => {
      const entryPath = installEntryWrapper(cwd);
      expect(runCli(["init"], cwd).status).toBe(0);
      expect(runCli(["enable", "always"], cwd).status).toBe(0);
      expect(
        runCli(
          ["task", "new", "--title", "Queued", "--level", "1", "--reason", "r"],
          cwd,
        ).status,
      ).toBe(0);

      const result = runEntryWrapper(entryPath);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    });
  });

  it("exits 1 with the stable adapter error when config.json is missing", () => {
    withTemporaryDirectory((cwd) => {
      const entryPath = installEntryWrapper(cwd);
      // No tc init / tc enable: .taskcraft/config.json is absent, exactly
      // like the old inline gate run without the takeover config — the
      // wrapper must fail loudly (exit 1, stable code), never exit 0.
      const result = runEntryWrapper(entryPath);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_ADAPTER_HOOK_INSTALL_FAILED");
    });
  });

  it("prints the breadcrumb for the unique active task", () => {
    withTemporaryDirectory((cwd) => {
      const entryPath = installEntryWrapper(cwd);
      expect(runCli(["init"], cwd).status).toBe(0);
      expect(runCli(["enable", "always"], cwd).status).toBe(0);
      expect(
        runCli(
          ["task", "new", "--title", "Active", "--level", "1", "--reason", "r"],
          cwd,
        ).status,
      ).toBe(0);
      expect(runCli(["run", "T-1"], cwd).status).toBe(0);

      const result = runEntryWrapper(entryPath);

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
});
