// runAgentTestHook scenarios: the installed-hooks field test exercises a real
// project setup (installed scripts, host registration, takeover enabled) with
// fake host spawn outcomes for the pre-flight failures (scripts/gate artifact/
// registration/takeover/feature/trust), the chain failures (injection/block/
// loop guard) and the enforced success, plus the config.hookTests persistence
// contract. No real host binary is ever spawned.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCodexAdapter } from "../../src/adapters/codex.js";
import { createClaudeAdapter } from "../../src/adapters/claude.js";
import type { HostAdapter } from "../../src/adapters/types.js";
import { ERROR_CODES, TaskcraftError } from "../../src/core/errors.js";
import { runAgentTestHook } from "../../src/commands/agent.js";
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

/** Real project setup for runAgentTestHook: installed hook scripts (exactly
 * the production wrapper layout — they reference the compiled gates next to
 * the built CLI, dist/hooks/*.js, which exist because the suite builds
 * first), project-level host registration, takeover enabled in config.json
 * and a codex user config trusting the project. The Task Store itself is
 * only exercised by real hosts; fake spawn outcomes drive the chain
 * judgments. */
function setupProject(agent: "codex" | "claude"): ProjectSetup {
  const temporary = createTemporaryDirectory();
  const projectDir = temporary.path;
  const hooksDir = join(projectDir, ".taskcraft", "hooks");
  const entryPath = join(hooksDir, "entry.sh");
  const stopPath = join(hooksDir, "stop.sh");

  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(
    entryPath,
    `#!/usr/bin/env bash\nnode "${join(process.cwd(), "dist", "hooks", "entry.js")}" "$(dirname "$0")/../config.json"\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    stopPath,
    `#!/usr/bin/env bash\nnode "${join(process.cwd(), "dist", "hooks", "stop.js")}" "$(dirname "$0")/../config.json"\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(projectDir, ".taskcraft", "config.json"),
    `${JSON.stringify({ takeOver: "ask" }, null, 2)}\n`,
    "utf8",
  );

  if (agent === "codex") {
    mkdirSync(join(projectDir, ".codex"), { recursive: true });
    writeFileSync(
      join(projectDir, ".codex", "config.toml"),
      `hooks.SessionStart = [{ command = "bash ${entryPath}" }]\nhooks.Stop = [{ command = "bash ${stopPath}" }]\n`,
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
            Stop: [
              { hooks: [{ type: "command", command: `bash "${stopPath}"` }] },
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

/** Scripts the fake spawn outcomes for a fully passing chain: host stdout
 * carries the injected breadcrumb, the stop wrapper blocks (exit 2 +
 * breadcrumb) and allows the stop_hook_active re-entry (exit 0). */
function scriptPassingChain(
  fake: FakeHost,
  agent: "codex" | "claude",
  stopScript: string,
): void {
  fake.setSpawnScript(agent, {
    stdout: `${BREADCRUMB_LINE}\nagent: TC_FIRST\n`,
  });
  fake.setSpawnScript(
    "bash",
    { stdout: `${BREADCRUMB_LINE}\n`, exitCode: 2 },
    { args: [stopScript] },
  );
  fake.setSpawnScript(
    "bash",
    { stdout: "", exitCode: 0 },
    { args: [stopScript], input: '{"stop_hook_active":true}' },
  );
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

function stopScriptPath(projectDir: string): string {
  return join(projectDir, ".taskcraft", "hooks", "stop.sh");
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
      runAgentTestHook(adapter, setup.projectDir);
      throw new Error("expected TC_ADAPTER_HOOK_TEST_FAILED");
    } catch (error) {
      expectTestFailed(error, fragment);
    }
  } finally {
    setup.cleanup();
  }
}

describe("runAgentTestHook pre-flight", () => {
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

describe("runAgentTestHook chain judgments", () => {
  it("reports ok with enforced when injection, block and loop guard all pass", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude");
    scriptPassingChain(fake, "claude", stopScriptPath(setup.projectDir));

    try {
      const summary = runAgentTestHook(claudeAdapter(fake), setup.projectDir);

      expect(summary.ok).toBe(true);
      expect(summary.host).toBe("claude");
      expect(summary.version).toBe("2.1.220");
      expect(summary.entryInjected).toBe(true);
      expect(summary.stopBlocked).toBe(true);
      expect(summary.loopGuardOk).toBe(true);
      expect(summary.enforced).toBe(true);
      expect(summary.testedAt).toBe(FIXED_NOW);
    } finally {
      setup.cleanup();
    }
  });

  it("persists the outcome into config.hookTests", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude");
    scriptPassingChain(fake, "claude", stopScriptPath(setup.projectDir));

    try {
      runAgentTestHook(claudeAdapter(fake), setup.projectDir);
      const config = JSON.parse(
        readFileSync(
          join(setup.projectDir, ".taskcraft", "config.json"),
          "utf8",
        ),
      ) as { hookTests: unknown };

      expect(config.hookTests).toEqual({
        claude: {
          testedAt: FIXED_NOW,
          version: "2.1.220",
          ok: true,
          enforced: true,
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
        runAgentTestHook(claudeAdapter(fake), setup.projectDir);
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
        hookTests: Record<
          string,
          { ok: boolean; enforced: boolean; failure: string }
        >;
      };
      expect(config.hookTests.claude).toMatchObject({
        ok: false,
        enforced: false,
        failure: expect.stringContaining("tc-breadcrumb/v1"),
      });
    } finally {
      setup.cleanup();
    }
  });

  it("fails when the stop hook does not block", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude");
    fake.setSpawnScript("claude", {
      stdout: `${BREADCRUMB_LINE}\nagent: TC_FIRST\n`,
    });

    expectHookTestFailure(claudeAdapter(fake), setup, "did not block");
  });

  it("fails when the loop guard does not allow the re-entry", () => {
    const fake = createFakeHost();
    const setup = setupProject("claude");
    fake.setSpawnScript("claude", {
      stdout: `${BREADCRUMB_LINE}\nagent: TC_FIRST\n`,
    });
    fake.setSpawnScript(
      "bash",
      { stdout: `${BREADCRUMB_LINE}\n`, exitCode: 2 },
      { args: [stopScriptPath(setup.projectDir)] },
    );
    fake.setSpawnScript(
      "bash",
      { stdout: "", exitCode: 2 },
      {
        args: [stopScriptPath(setup.projectDir)],
        input: '{"stop_hook_active":true}',
      },
    );

    expectHookTestFailure(claudeAdapter(fake), setup, "loop guard");
  });

  it("reports enforced for codex when the full chain passes", () => {
    const fake = createFakeHost();
    const setup = setupProject("codex");
    scriptPassingChain(fake, "codex", stopScriptPath(setup.projectDir));

    try {
      const summary = runAgentTestHook(
        codexAdapter(fake, setup.userConfigPath),
        setup.projectDir,
      );

      expect(summary.ok).toBe(true);
      expect(summary.host).toBe("codex");
      expect(summary.version).toBe("0.147.0");
      expect(summary.enforced).toBe(true);
    } finally {
      setup.cleanup();
    }
  });
});
