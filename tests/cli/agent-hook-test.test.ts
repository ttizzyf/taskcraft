// runAgentTestEntryHook scenarios: the installed Entry Hook field test exercises a real
// project setup (installed scripts, host registration, takeover enabled) with
// fake host spawn outcomes for the pre-flight failures (scripts/gate artifact/
// registration/takeover/feature/trust), the injection failures and success,
// plus the config.entryHookTests persistence
// contract. No real host binary is ever spawned.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createCodexAdapter } from "../../src/adapters/codex.js";
import { createClaudeAdapter } from "../../src/adapters/claude.js";
import type { HostAdapter } from "../../src/adapters/types.js";
import { ERROR_CODES, TaskcraftError } from "../../src/core/errors.js";
import { run, taskNew } from "../../src/core/reducer.js";
import { runAgentTestEntryHook } from "../../src/commands/agent.js";
import { openDatabase } from "../../src/store/database.js";
import { applyMigrations } from "../../src/store/migrations.js";
import {
  BREADCRUMB_LINE,
  createFakeHost,
  FIXED_NOW,
} from "../helpers/fake-host.js";
import type { FakeHost } from "../helpers/fake-host.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

interface ProjectSetup {
  projectDir: string;
  userConfigPath: string;
  cleanup(): void;
}

/** Real project setup for runAgentTestEntryHook: the installed Entry wrapper
 * the production wrapper layout — they reference the compiled gates next to
 * the built CLI, dist/hooks/*.js, which exist because the suite builds
 * first), project-level host registration, takeover enabled in config.json
 * and a codex user config trusting the project. The Task Store itself is
 * only exercised by real hosts; fake spawn outcomes drive the chain
 * judgments. */
function setupProject(
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
  if (activateTask) {
    run(database, taskId);
  }
  database.close();

  if (agent === "codex") {
    mkdirSync(join(projectDir, ".codex"), { recursive: true });
    writeFileSync(
      join(projectDir, ".codex", "config.toml"),
      `hooks.SessionStart = [{ command = "bash ${entryPath}" }]\n`,
      "utf8",
    );
  } else {
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(
      join(projectDir, ".claude", "settings.json"),
      `${JSON.stringify(
        {
          hooks: {
            SessionStart: [
              { hooks: [{ type: "command", command: `bash "${entryPath}"` }] },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const userConfigPath = join(projectDir, "codex-user-config.toml");
  writeFileSync(
    userConfigPath,
    `[projects."${projectDir}"]\ntrust_level = "trusted"\n`,
    "utf8",
  );

  return { projectDir, userConfigPath, cleanup: temporary.cleanup };
}

/** Scripts a successful host call whose output carries the injected breadcrumb. */
function scriptPassingChain(fake: FakeHost, agent: "codex" | "claude"): void {
  fake.setSpawnScript(agent, {
    stdout: `${BREADCRUMB_LINE}\nagent: TC_FIRST\n`,
  });
}

function claudeAdapter(fake: FakeHost): HostAdapter {
  fake.setProbeScript("claude", ["--version"], { stdout: "2.1.220\n" });

  return createClaudeAdapter(fake.deps());
}

function codexAdapter(fake: FakeHost, userConfigPath: string): HostAdapter {
  fake.setProbeScript("codex", ["--version"], { stdout: "0.147.0\n" });
  fake.setProbeScript("codex", ["features", "list"], {
    stdout: "hooks stable true\n",
  });
  fake.setProbeScript("codex", ["exec", "--help"], { stdout: "help text\n" });

  return createCodexAdapter({ ...fake.deps(), userConfigPath });
}

function expectTestFailed(error: unknown, fragment: string): void {
  expect(error).toBeInstanceOf(TaskcraftError);
  const taskcraftError = error as TaskcraftError;
  expect(taskcraftError.code).toBe(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED);
  expect(taskcraftError.problem).toContain(fragment);
  expect(taskcraftError.impact).toBeTruthy();
  expect(taskcraftError.remediation).toBeTruthy();
}

/** Runs the field test and asserts the stable TC_ADAPTER_HOOK_TEST_FAILED
 * three-part diagnostic; cleans the project up afterwards. */
function expectHookTestFailure(
  adapter: HostAdapter,
  setup: ProjectSetup,
  fragment: string,
): void {
  try {
    try {
      runAgentTestEntryHook(adapter, setup.projectDir);
      throw new Error("expected TC_ADAPTER_HOOK_TEST_FAILED");
    } catch (error) {
      expectTestFailed(error, fragment);
    }
  } finally {
    setup.cleanup();
  }
}

describe("runAgentTestEntryHook pre-flight", () => {
  it("fails explicitly when the hook scripts are missing", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude");
    rmSync(join(setup.projectDir, ".taskcraft", "hooks"), {
      recursive: true,
      force: true,
    });

    expectHookTestFailure(claudeAdapter(fake), setup, "entry.sh");
  });

  it("fails explicitly when a script references a missing gate artifact", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude");
    writeFileSync(
      join(setup.projectDir, ".taskcraft", "hooks", "entry.sh"),
      '#!/usr/bin/env bash\nnode "/nonexistent/entry.js" "$(dirname "$0")/../config.json"\n',
      { mode: 0o755 },
    );

    expectHookTestFailure(claudeAdapter(fake), setup, "missing gate artifact");
  });

  it("fails explicitly when the project config does not register the hooks", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude");
    rmSync(join(setup.projectDir, ".claude", "settings.json"), {
      force: true,
    });

    expectHookTestFailure(claudeAdapter(fake), setup, "not registered");
  });

  for (const agent of ["codex", "claude"] as const) {
    it(`${agent}: fails when SessionStart points to a different entry.sh`, () => {
      const fake = createFakeHost();
      const setup = setupProject(agent);

      if (agent === "codex") {
        writeFileSync(
          join(setup.projectDir, ".codex", "config.toml"),
          'hooks.SessionStart = [{ command = "bash /wrong/.taskcraft/hooks/entry.sh" }]\n',
          "utf8",
        );
      } else {
        writeFileSync(
          join(setup.projectDir, ".claude", "settings.json"),
          JSON.stringify({
            hooks: {
              SessionStart: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash /wrong/.taskcraft/hooks/entry.sh",
                    },
                  ],
                },
              ],
            },
          }),
          "utf8",
        );
      }

      const adapter =
        agent === "codex"
          ? codexAdapter(fake, setup.userConfigPath)
          : claudeAdapter(fake);
      expectHookTestFailure(adapter, setup, "not registered");
    });
  }

  it("fails explicitly when takeover is off", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude");
    writeFileSync(
      join(setup.projectDir, ".taskcraft", "config.json"),
      `${JSON.stringify({ takeOver: "off" }, null, 2)}\n`,
      "utf8",
    );

    expectHookTestFailure(claudeAdapter(fake), setup, "takeover is off");
  });

  it("fails before spawning a host when no active task can produce a breadcrumb", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude", false);

    expectHookTestFailure(
      claudeAdapter(fake),
      setup,
      "requires exactly one active",
    );
    expect(fake.calls.some((call) => call.kind === "spawn")).toBe(false);
  });

  it("fails explicitly when the config is missing", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude");
    rmSync(join(setup.projectDir, ".taskcraft", "config.json"), {
      force: true,
    });

    expectHookTestFailure(claudeAdapter(fake), setup, "config.json");
  });

  it("fails explicitly when the codex hooks feature gate is not satisfied", () => {
    const fake = createFakeHost();
    const setup = setupProject("codex");
    fake.setProbeScript("codex", ["--version"], { stdout: "0.147.0\n" });
    fake.setProbeScript("codex", ["features", "list"], {
      stdout: "no capabilities mentioned\n",
    });
    fake.setProbeScript("codex", ["exec", "--help"], { stdout: "help\n" });

    expectHookTestFailure(
      createCodexAdapter({
        ...fake.deps(),
        userConfigPath: setup.userConfigPath,
      }),
      setup,
      "hooks feature gate",
    );
  });

  it("fails explicitly when the codex hooks feature exists but is disabled", () => {
    const fake = createFakeHost();
    const setup = setupProject("codex");
    fake.setProbeScript("codex", ["--version"], { stdout: "0.147.0\n" });
    fake.setProbeScript("codex", ["features", "list"], {
      stdout: "hooks stable false\n",
    });
    fake.setProbeScript("codex", ["exec", "--help"], { stdout: "help\n" });

    expectHookTestFailure(
      createCodexAdapter({
        ...fake.deps(),
        userConfigPath: setup.userConfigPath,
      }),
      setup,
      "not enabled",
    );
  });

  it("fails explicitly when the codex project trust is not confirmed", () => {
    const fake = createFakeHost();
    const setup = setupProject("codex");
    writeFileSync(setup.userConfigPath, "# no trusted projects\n", "utf8");

    expectHookTestFailure(
      codexAdapter(fake, setup.userConfigPath),
      setup,
      "trust gate",
    );
  });
});

describe("runAgentTestEntryHook judgments", () => {
  it("reports ok when Entry injection passes", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude");
    scriptPassingChain(fake, "claude");

    try {
      const summary = runAgentTestEntryHook(
        claudeAdapter(fake),
        setup.projectDir,
      );

      expect(summary.ok).toBe(true);
      expect(summary.host).toBe("claude");
      expect(summary.version).toBe("2.1.220");
      expect(summary.entryInjected).toBe(true);
      expect(summary.testedAt).toBe(FIXED_NOW);
    } finally {
      setup.cleanup();
    }
  });

  it("persists the outcome into config.entryHookTests", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude");
    scriptPassingChain(fake, "claude");

    try {
      runAgentTestEntryHook(claudeAdapter(fake), setup.projectDir);
      const config = JSON.parse(
        readFileSync(
          join(setup.projectDir, ".taskcraft", "config.json"),
          "utf8",
        ),
      ) as { entryHookTests: unknown };

      expect(config.entryHookTests).toEqual({
        claude: {
          testedAt: FIXED_NOW,
          version: "2.1.220",
          ok: true,
        },
      });
    } finally {
      setup.cleanup();
    }
  });

  it("fails when the entry is not injected and persists the failure", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude");
    fake.setSpawnScript("claude", { stdout: "agent: TC_FIRST\n" });

    try {
      try {
        runAgentTestEntryHook(claudeAdapter(fake), setup.projectDir);
        throw new Error("expected TC_ADAPTER_HOOK_TEST_FAILED");
      } catch (error) {
        expectTestFailed(error, "tc-breadcrumb/v1");
      }

      const config = JSON.parse(
        readFileSync(
          join(setup.projectDir, ".taskcraft", "config.json"),
          "utf8",
        ),
      ) as {
        entryHookTests: Record<string, { ok: boolean; failure: string }>;
      };
      expect(config.entryHookTests.claude).toMatchObject({
        ok: false,
        failure: expect.stringContaining("tc-breadcrumb/v1"),
      });
    } finally {
      setup.cleanup();
    }
  });

  it("reports ok for codex when Entry injection passes", () => {
    const fake = createFakeHost();
    const setup = setupProject("codex");
    scriptPassingChain(fake, "codex");

    try {
      const summary = runAgentTestEntryHook(
        codexAdapter(fake, setup.userConfigPath),
        setup.projectDir,
      );

      expect(summary.ok).toBe(true);
      expect(summary.host).toBe("codex");
      expect(summary.version).toBe("0.147.0");
      expect(summary.entryInjected).toBe(true);
    } finally {
      setup.cleanup();
    }
  });
});
