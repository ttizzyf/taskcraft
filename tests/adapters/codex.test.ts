import { describe, expect, it, vi } from "vitest";

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Records real writes so conformance can assert installEntry never touches
 * anything outside the project directory. Declared in the test file (the
 * module-graph root) because vi.mock is hoisted per test file. */
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
  };
});

import { createCodexAdapter } from "../../src/adapters/codex.js";
import type { CodexProjectConfig } from "../../src/adapters/codex.js";
import {
  buildCodexProjectConfig,
  serializeCodexProjectConfig,
} from "../../src/adapters/codex.js";
import { createFakeHost, BREADCRUMB_LINE } from "../helpers/fake-host.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";
import { runConformance } from "./conformance.js";

describe("codex adapter", () => {
  const fake = createFakeHost();

  runConformance((deps) => createCodexAdapter(deps), fake, fsWriteLog);

  it("derives capabilities from codex-specific probe text", () => {
    fake.reset();
    fake.setProbeScript("codex", ["--version"], { stdout: "0.147.0\n" });
    fake.setProbeScript("codex", ["features", "list"], {
      stdout: "hooks: stable\nmulti_agent: stable\n",
    });
    fake.setProbeScript("codex", ["exec", "--help"], {
      stdout: "output schema and resume supported\n",
    });

    const capabilities = createCodexAdapter(fake.deps()).capabilities();

    expect(capabilities.version).toBe("0.147.0");
    expect(
      capabilities.items.find((item) => item.name === "session-start"),
    ).toMatchObject({ available: true });
    expect(
      capabilities.items.find((item) => item.name === "stop"),
    ).toMatchObject({ available: true });
    expect(
      capabilities.items.find((item) => item.name === "structured-output"),
    ).toMatchObject({
      available: true,
      limitation: expect.stringContaining("502"),
    });
    expect(
      capabilities.items.find((item) => item.name === "run-correlation"),
    ).toMatchObject({ available: true });
  });

  it("reports unavailable when the probe text lacks the keyword", () => {
    fake.reset();
    fake.setProbeScript("codex", ["--version"], { stdout: "0.147.0\n" });
    fake.setProbeScript("codex", ["features", "list"], {
      stdout: "no stable capabilities mentioned\n",
    });
    fake.setProbeScript("codex", ["exec", "--help"], { stdout: "minimal\n" });

    const capabilities = createCodexAdapter(fake.deps()).capabilities();

    expect(
      capabilities.items.find((item) => item.name === "session-start"),
    ).toMatchObject({
      available: false,
      limitation: expect.stringContaining("hooks"),
    });
    expect(
      capabilities.items.find((item) => item.name === "structured-output"),
    ).toMatchObject({ available: false });
  });

  it("testHook spawns codex exec with the minimal prompt and the installed scripts", () => {
    fake.reset();
    const projectDir = createTemporaryDirectory();
    const entryScript = join(
      projectDir.path,
      ".taskcraft",
      "hooks",
      "entry.sh",
    );
    const stopScript = join(projectDir.path, ".taskcraft", "hooks", "stop.sh");
    fake.setProbeScript("codex", ["features", "list"], {
      stdout: "hooks stable true\n",
    });
    fake.setSpawnScript("codex", {
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

    const userConfigPath = join(projectDir.path, "codex-user-config.toml");
    writeFileSync(
      userConfigPath,
      `[projects."${projectDir.path}"]\ntrust_level = "trusted"\n`,
      "utf8",
    );

    try {
      const adapter = createCodexAdapter({ ...fake.deps(), userConfigPath });
      const result = adapter.testHook({
        projectDir: projectDir.path,
        entryScript,
        stopScript,
      });

      expect(result.ok).toBe(true);
      expect(result.enforced).toBe(true);
      const call = fake.calls.find(
        (entry) => entry.kind === "spawn" && entry.command === "codex",
      );
      expect(call?.command).toBe("codex");
      expect(call?.args[0]).toBe("exec");
      expect(call?.args).toContain("--json");
      expect(call?.args.at(-1)).toBe("Reply exactly TC_FIRST.");
    } finally {
      projectDir.cleanup();
    }
  });

  it("installEntry registers hooks in .codex/config.toml", () => {
    const projectDir = createTemporaryDirectory();

    try {
      const adapter = createCodexAdapter(fake.deps());
      const result = adapter.installEntry({
        projectDir: projectDir.path,
        takeOver: "always",
      });

      expect(result.ok).toBe(true);
      const config = readFileSync(
        join(projectDir.path, ".codex", "config.toml"),
        "utf8",
      );
      expect(config).toContain("hooks.SessionStart");
      expect(config).toContain("hooks.Stop");
      expect(config).toContain("entry.sh");
    } finally {
      projectDir.cleanup();
    }
  });

  it("buildCodexProjectConfig merges without duplicating or mutating", () => {
    const commands = { entry: "bash /p/entry.sh", stop: "bash /p/stop.sh" };
    const existing: CodexProjectConfig = {
      hooks: {
        SessionStart: [{ command: "bash /p/entry.sh" }],
      },
    };

    const merged = buildCodexProjectConfig(existing, commands);

    expect(merged.hooks?.SessionStart).toEqual([
      { command: "bash /p/entry.sh" },
    ]);
    expect(merged.hooks?.Stop).toEqual([{ command: "bash /p/stop.sh" }]);
    expect(existing.hooks?.SessionStart).toHaveLength(1);
    expect(existing.hooks?.Stop).toBeUndefined();
    expect(serializeCodexProjectConfig(merged)).toContain(
      'hooks.SessionStart = [{ command = "bash /p/entry.sh" }]',
    );
  });
});
