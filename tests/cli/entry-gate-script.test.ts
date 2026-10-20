// Installed Node entry gate (.taskcraft/hooks/entry.mjs) — the wrapper Windows
// hosts run, because they have no bash. It must behave exactly like the bash
// wrapper: takeOver off, no task and non-active projections stay silent with
// exit 0; the unique active task prints a text label followed by exactly one
// breadcrumb line. The gate derives the project root from its own location, so
// the spawn cwd is intentionally different from the project (cwd-independence
// proof), and it is spawned through node rather than a shell.

import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { entryGateTemplate } from "../../src/adapters/entry-scripts.js";
import { BREADCRUMB_SCHEMA_VERSION } from "../../src/core/breadcrumb.js";
import { run, taskNew } from "../../src/core/reducer.js";
import { openDatabase } from "../../src/store/database.js";
import { applyMigrations } from "../../src/store/migrations.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";
import { linkBuiltCli } from "./helpers.js";

const execFileAsync = promisify(execFile);

interface GateResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Spawns the gate with the same runtime that runs the tests; async so it does
 * not depend on a synchronous spawn seam. */
async function runGate(gatePath: string): Promise<GateResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [gatePath],
      { encoding: "utf8" },
    );

    return { status: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };

    return {
      status: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

function installGate(projectDir: string): string {
  linkBuiltCli(projectDir);
  const hooksDir = join(projectDir, ".taskcraft", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const gatePath = join(hooksDir, "entry.mjs");
  writeFileSync(gatePath, entryGateTemplate(), "utf8");

  return gatePath;
}

function writeTakeOver(projectDir: string, mode: string): void {
  writeFileSync(
    join(projectDir, ".taskcraft", "config.json"),
    `${JSON.stringify({ takeOver: mode }, null, 2)}\n`,
    "utf8",
  );
}

function withStore(projectDir: string, createTask: boolean): void {
  const database = openDatabase(join(projectDir, ".taskcraft", "taskcraft.db"));
  applyMigrations(database, resolve("migrations"));

  if (createTask) {
    const { taskId } = taskNew(database, {
      title: "Gate",
      level: 1,
      reason: "test fixture",
    });
    run(database, taskId);
  }

  database.close();
}

describe("installed Node entry gate equivalence", () => {
  it("stays silent when takeover is off", async () => {
    const projectDir = createTemporaryDirectory();

    try {
      const gatePath = installGate(projectDir.path);
      writeTakeOver(projectDir.path, "off");
      withStore(projectDir.path, true);

      const result = await runGate(gatePath);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      projectDir.cleanup();
    }
  });

  it("stays silent when no task exists", async () => {
    const projectDir = createTemporaryDirectory();

    try {
      const gatePath = installGate(projectDir.path);
      writeTakeOver(projectDir.path, "always");
      withStore(projectDir.path, false);

      const result = await runGate(gatePath);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      projectDir.cleanup();
    }
  });

  it("stays silent while the only task is not active", async () => {
    const projectDir = createTemporaryDirectory();

    try {
      const gatePath = installGate(projectDir.path);
      writeTakeOver(projectDir.path, "always");
      const database = openDatabase(
        join(projectDir.path, ".taskcraft", "taskcraft.db"),
      );
      applyMigrations(database, resolve("migrations"));
      taskNew(database, {
        title: "Queued",
        level: 1,
        reason: "test fixture",
      });
      database.close();

      const result = await runGate(gatePath);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    } finally {
      projectDir.cleanup();
    }
  });

  it("exits 1 with the stable adapter error when config.json is missing", async () => {
    const projectDir = createTemporaryDirectory();

    try {
      const gatePath = installGate(projectDir.path);
      // No .taskcraft/config.json: the gate must fail loudly with the stable
      // code, never exit 0 as if it had nothing to say.
      const result = await runGate(gatePath);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_ADAPTER_HOOK_INSTALL_FAILED");
    } finally {
      projectDir.cleanup();
    }
  });

  it("prints plain hook context and the breadcrumb for the unique active task", async () => {
    const projectDir = createTemporaryDirectory();

    try {
      const gatePath = installGate(projectDir.path);
      writeTakeOver(projectDir.path, "always");
      withStore(projectDir.path, true);

      const result = await runGate(gatePath);

      expect(result.status).toBe(0);
      const lines = result.stdout.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe("Taskcraft Entry context:");
      const breadcrumb = JSON.parse(lines[1]!) as {
        schemaVersion: string;
        task: { id: string; status: string };
      };
      expect(breadcrumb.schemaVersion).toBe(BREADCRUMB_SCHEMA_VERSION);
      expect(breadcrumb.task.id).toBe("T-1");
      expect(breadcrumb.task.status).toBe("active");
    } finally {
      projectDir.cleanup();
    }
  });
});
