// tc init --agent codex|claude: entry.sh lands in .taskcraft/hooks/ and the
// project-level host config (write-if-absent, idempotent, never overwriting
// user content); unknown agents fail with TC_ADAPTER_UNSUPPORTED; every real
// write stays inside the project directory (global host config untouched).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ERROR_CODES, TaskcraftError } from "../../src/core/errors.js";
import { installAgentHooks } from "../../src/commands/init.js";
import { runCli, withTemporaryDirectory } from "./helpers.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

/** Records real writes so the write-confinement tests can assert installAgent
 * never touches anything outside the project directory. Declared at module
 * top level because vi.mock is hoisted per test file. */
const fsWriteLog = vi.hoisted(() => ({
  paths: [] as string[],
  reset(): void {
    this.paths.length = 0;
  },
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  return {
    ...actual,
    writeFileSync: (...args: unknown[]): unknown => {
      fsWriteLog.paths.push(String(args[0]));
      return (actual.writeFileSync as (...rest: unknown[]) => unknown)(...args);
    },
    mkdirSync: (...args: unknown[]): unknown => {
      fsWriteLog.paths.push(String(args[0]));
      return (actual.mkdirSync as (...rest: unknown[]) => unknown)(...args);
    },
    renameSync: (...args: unknown[]): unknown => {
      fsWriteLog.paths.push(String(args[0]));
      return (actual.renameSync as (...rest: unknown[]) => unknown)(...args);
    },
  };
});

describe("tc init --agent (CLI)", () => {
  it("installs the Codex Entry Hook and registers SessionStart", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["init", "--agent", "codex"], cwd);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Installed hooks for agent: codex");

      const entry = readFileSync(
        join(cwd, ".taskcraft", "hooks", "entry.sh"),
        "utf8",
      );
      // The Entry wrapper delegates to the public CLI (state --breadcrumb).
      expect(entry).toContain("dist/cli.js");
      expect(entry).toContain("state --breadcrumb");
      expect(existsSync(join(cwd, ".taskcraft", "hooks", "stop.sh"))).toBe(
        false,
      );

      const config = readFileSync(join(cwd, ".codex", "config.toml"), "utf8");
      expect(config).toContain("hooks.SessionStart");
      expect(config).not.toContain("hooks.Stop");
      expect(config).toContain("entry.sh");
    });
  });

  it("installs the Claude Entry Hook and registers SessionStart", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["init", "--agent", "claude"], cwd);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Installed hooks for agent: claude");

      const settings = JSON.parse(
        readFileSync(join(cwd, ".claude", "settings.json"), "utf8"),
      ) as { hooks: { SessionStart: unknown[]; Stop?: unknown[] } };
      expect(settings.hooks.SessionStart).toHaveLength(1);
      expect(settings.hooks.Stop).toBeUndefined();
    });
  });

  it("fails explicitly when the host config already exists instead of a partial success", () => {
    withTemporaryDirectory((cwd) => {
      const configFile = join(cwd, ".codex", "config.toml");
      mkdirSync(join(cwd, ".codex"), { recursive: true });
      writeFileSync(
        configFile,
        'model = "claude-sonnet"\n# user content must survive\n',
        "utf8",
      );

      const result = runCli(["init", "--agent", "codex"], cwd);

      // The hooks scripts still land, but the missing registration is an
      // explicit failure (never ok=true + limitation).
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_ADAPTER_HOOK_INSTALL_FAILED");
      expect(result.stderr).toContain("config exists; hooks not registered");
      expect(result.stderr).toContain("Merge the hook commands");
      expect(existsSync(join(cwd, ".taskcraft", "hooks", "entry.sh"))).toBe(
        true,
      );
      expect(readFileSync(configFile, "utf8")).toContain(
        "user content must survive",
      );
    });
  });

  it("rejects an unknown agent with TC_ADAPTER_UNSUPPORTED", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["init", "--agent", "gemini"], cwd);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_ADAPTER_UNSUPPORTED");
      expect(result.stderr).toContain("tc init --agent codex|claude");
      expect(existsSync(join(cwd, ".taskcraft", "hooks"))).toBe(false);
    });
  });
});

describe("installAgentHooks write confinement", () => {
  for (const agent of ["codex", "claude"] as const) {
    it(`${agent}: every write lands inside the project directory`, () => {
      const projectDir = createTemporaryDirectory();

      try {
        fsWriteLog.reset();
        const installed = installAgentHooks(agent, projectDir.path);

        expect(installed.agent).toBe(agent);
        expect(installed.hookPaths).toHaveLength(1);
        expect(fsWriteLog.paths.length).toBeGreaterThan(0);
        expect(
          fsWriteLog.paths.every((path) => path.startsWith(projectDir.path)),
        ).toBe(true);
      } finally {
        projectDir.cleanup();
      }
    });
  }

  it("rejects an unknown agent with the stable error", () => {
    const projectDir = createTemporaryDirectory();

    try {
      try {
        installAgentHooks("gemini", projectDir.path);
        throw new Error("expected TC_ADAPTER_UNSUPPORTED");
      } catch (error) {
        expect(error).toBeInstanceOf(TaskcraftError);
        expect((error as TaskcraftError).code).toBe(
          ERROR_CODES.TC_ADAPTER_UNSUPPORTED,
        );
      }
    } finally {
      projectDir.cleanup();
    }
  });
});
