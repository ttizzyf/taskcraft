// tc enable off|ask|always: config read-modify-write (atomic tmp+rename,
// other fields preserved), off must mean zero hook output, invalid modes fail
// with a stable error, and the hook script entry points keep their stderr
// diagnostics contract.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli, withTemporaryDirectory } from "./helpers.js";

function configPath(cwd: string): string {
  return join(cwd, ".taskcraft", "config.json");
}

function readConfig(cwd: string): unknown {
  return JSON.parse(readFileSync(configPath(cwd), "utf8")) as unknown;
}

describe("tc enable", () => {
  it("creates .taskcraft/config.json with the requested mode", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["enable", "ask"], cwd);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Takeover mode: ask");

      const config = readConfig(cwd) as { takeOver: string };
      expect(config.takeOver).toBe("ask");
    });
  });

  it("preserves existing fields such as agents when switching modes", () => {
    withTemporaryDirectory((cwd) => {
      mkdirSync(join(cwd, ".taskcraft"), { recursive: true });
      writeFileSync(
        configPath(cwd),
        JSON.stringify({ takeOver: "ask", agents: ["codex"] }, null, 2),
        "utf8",
      );

      const result = runCli(["enable", "always"], cwd);
      expect(result.status).toBe(0);

      const config = readConfig(cwd) as {
        takeOver: string;
        agents: string[];
      };
      expect(config.takeOver).toBe("always");
      expect(config.agents).toEqual(["codex"]);
    });
  });

  it("switches ask -> always -> off with zero hook output at off", () => {
    withTemporaryDirectory((cwd) => {
      expect(runCli(["enable", "ask"], cwd).status).toBe(0);
      expect(runCli(["enable", "always"], cwd).status).toBe(0);
      const off = runCli(["enable", "off"], cwd);

      expect(off.status).toBe(0);
      expect(off.stdout).toContain("Takeover mode: off");
      expect(off.stdout).toContain("silent (zero output)");

      const config = readConfig(cwd) as { takeOver: string };
      expect(config.takeOver).toBe("off");

      // REQ-03: `enable off` must mean zero hook output — run the compiled
      // gate entry point against this config and expect empty stdout.
      const hook = spawnSync(
        process.execPath,
        [join(process.cwd(), "dist", "hooks", "entry.js"), configPath(cwd)],
        { encoding: "utf8" },
      );

      expect(hook.stdout).toBe("");
      expect(hook.status).toBe(0);
      expect(off.stdout).not.toContain("Stop hook");
    });
  });

  it("writes atomically without leftover temporary files", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["enable", "always"], cwd);
      expect(result.status).toBe(0);

      const leftovers = readdirSync(join(cwd, ".taskcraft")).filter((name) =>
        name.includes("tmp"),
      );
      expect(leftovers).toEqual([]);
    });
  });

  it("supports JSON output", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["enable", "--json", "off"], cwd);

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        ok: boolean;
        data: { takeOver: string; entryOutput: null };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.data.takeOver).toBe("off");
      expect(parsed.data.entryOutput).toBeNull();
    });
  });

  it("rejects an invalid mode with a stable error", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["enable", "sometimes"], cwd);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("TC_TASK_INPUT_INVALID");
      expect(result.stderr).toContain("tc enable off|ask|always");
      expect(existsSync(configPath(cwd))).toBe(false);
    });
  });
});
