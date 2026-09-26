import { CLAUDE_ENTRY_STREAM } from "../adapters/claude-entry-fixture.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect } from "vitest";

import { createClaudeAdapter } from "../../src/adapters/claude.js";
import { createCodexAdapter } from "../../src/adapters/codex.js";
import type { HostAdapter } from "../../src/adapters/types.js";
import { runAgentTestEntryHook } from "../../src/commands/agent.js";
import { ERROR_CODES, TaskcraftError } from "../../src/core/errors.js";
import { run, taskNew } from "../../src/core/reducer.js";
import { openDatabase } from "../../src/store/database.js";
import { applyMigrations } from "../../src/store/migrations.js";
import { BREADCRUMB_LINE } from "../helpers/fake-host.js";
import type { FakeHost } from "../helpers/fake-host.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

export interface ProjectSetup {
  projectDir: string;
  userConfigPath: string;
  cleanup(): void;
}

export function setupProject(
  agent: "codex" | "claude",
  activateTask = true,
): ProjectSetup {
  const temporary = createTemporaryDirectory();
  const projectDir = temporary.path;
  const hooksDir = join(projectDir, ".taskcraft", "hooks");
  const entryPath = join(hooksDir, "entry.sh");

  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(
    entryPath,
    `#!/usr/bin/env bash\nnode "${join(process.cwd(), "dist", "hooks", "entry.js")}" "$(dirname "$0")/../config.json"\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(projectDir, ".taskcraft", "config.json"),
    `${JSON.stringify({ takeOver: "ask" }, null, 2)}\n`,
    "utf8",
  );

  const database = openDatabase(join(projectDir, ".taskcraft", "taskcraft.db"));
  applyMigrations(database, resolve("migrations"));
  const { taskId } = taskNew(database, {
    title: "Hook field test",
    level: 1,
    reason: "test fixture",
  });
  if (activateTask) run(database, taskId);
  database.close();

  const registration = {
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: `bash "${entryPath}"` }] },
      ],
    },
  };
  const registrationPath =
    agent === "codex"
      ? join(projectDir, ".codex", "hooks.json")
      : join(projectDir, ".claude", "settings.json");
  mkdirSync(resolve(registrationPath, ".."), { recursive: true });
  writeFileSync(
    registrationPath,
    `${JSON.stringify(registration, null, 2)}\n`,
    "utf8",
  );

  const userConfigPath = join(projectDir, "codex-user-config.toml");
  writeFileSync(
    userConfigPath,
    `[projects."${projectDir}"]\ntrust_level = "trusted"\n`,
    "utf8",
  );

  return { projectDir, userConfigPath, cleanup: temporary.cleanup };
}

export function scriptPassingChain(
  fake: FakeHost,
  agent: "codex" | "claude",
): void {
  fake.setSpawnScript(agent, {
    stdout:
      agent === "claude"
        ? CLAUDE_ENTRY_STREAM
        : `${BREADCRUMB_LINE}\nagent: TC_FIRST\n`,
  });
}

export function claudeAdapter(fake: FakeHost): HostAdapter {
  fake.setProbeScript("claude", ["--version"], { stdout: "2.1.220\n" });
  return createClaudeAdapter(fake.deps());
}

export function codexAdapter(
  fake: FakeHost,
  userConfigPath: string,
): HostAdapter {
  fake.setProbeScript("codex", ["--version"], { stdout: "0.147.0\n" });
  fake.setProbeScript("codex", ["features", "list"], {
    stdout: "hooks stable true\n",
  });
  fake.setProbeScript("codex", ["exec", "--help"], {
    stdout: "help text\n",
  });
  return createCodexAdapter({ ...fake.deps(), userConfigPath });
}

export function expectTestFailed(error: unknown, fragment: string): void {
  expect(error).toBeInstanceOf(TaskcraftError);
  const taskcraftError = error as TaskcraftError;
  expect(taskcraftError.code).toBe(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED);
  expect(taskcraftError.problem).toContain(fragment);
  expect(taskcraftError.impact).toBeTruthy();
  expect(taskcraftError.remediation).toBeTruthy();
}

export async function expectHookTestFailure(
  adapter: HostAdapter,
  setup: ProjectSetup,
  fragment: string,
): Promise<void> {
  try {
    try {
      await runAgentTestEntryHook(adapter, setup.projectDir);
      throw new Error("expected TC_ADAPTER_HOOK_TEST_FAILED");
    } catch (error) {
      expectTestFailed(error, fragment);
    }
  } finally {
    setup.cleanup();
  }
}
