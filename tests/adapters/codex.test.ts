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
    fake.setProbeScript("codex", ["--version"], {
      stdout: "codex-cli 0.147.0\n",
    });
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

  it("testEntryHook spawns codex exec with the minimal prompt", async () => {
    fake.reset();
    const projectDir = createTemporaryDirectory();
    const entryScript = join(
      projectDir.path,
      ".taskcraft",
      "hooks",
      "entry.sh",
    );
    fake.setProbeScript("codex", ["features", "list"], {
      stdout: "hooks stable true\n",
    });
    fake.setSpawnScript("codex", {
      stdout: `${BREADCRUMB_LINE}\nagent: TC_FIRST\n`,
    });

    const userConfigPath = join(projectDir.path, "codex-user-config.toml");
    writeFileSync(
      userConfigPath,
      `[projects."${projectDir.path}"]\ntrust_level = "trusted"\n`,
      "utf8",
    );

    try {
      const adapter = createCodexAdapter({ ...fake.deps(), userConfigPath });
      const result = await adapter.testEntryHook({
        projectDir: projectDir.path,
        entryScript,
      });

      expect(result.ok).toBe(true);
      expect(result.entryInjected).toBe(true);
      const call = fake.calls.find(
        (entry) => entry.kind === "spawn" && entry.command === "codex",
      );
      expect(call?.command).toBe("codex");
      expect(call?.args[0]).toBe("exec");
      expect(call?.args).toContain("--json");
      expect(call?.args.at(-1)).toBe(
        "If your injected context contains tc-breadcrumb/v1, reply exactly tc-breadcrumb/v1. Otherwise reply exactly NO_BREADCRUMB.",
      );
      expect(call?.args).not.toContain("--dangerously-bypass-hook-trust");
    } finally {
      projectDir.cleanup();
    }
  });

  it("installEntry registers only SessionStart in .codex/hooks.json", () => {
    const projectDir = createTemporaryDirectory();

    try {
      const adapter = createCodexAdapter(fake.deps());
      const result = adapter.installEntry({
        projectDir: projectDir.path,
        takeOver: "always",
      });

      expect(result.ok).toBe(true);
      const config = JSON.parse(
        readFileSync(join(projectDir.path, ".codex", "hooks.json"), "utf8"),
      ) as CodexProjectConfig;
      const registered = config.hooks?.SessionStart?.[0]?.hooks[0];

      expect(registered?.type).toBe("command");
      // Codex's documented repo-local form is the git-root anchor. Its Windows
      // form keeps the same anchor: the session shell there is PowerShell, where
      // `$(...)` is command substitution, so no shell-specific rewrite is used.
      expect(registered?.command).toContain("$(git rev-parse --show-toplevel)");
      expect(registered?.command).toContain("entry.sh");
      expect(registered?.commandWindows).toContain(
        "$(git rev-parse --show-toplevel)",
      );
      expect(registered?.commandWindows).toContain("entry.mjs");
      // A cmd `for /f` rewrite is a parse error in PowerShell, which is what a
      // Windows Codex session executes hooks in.
      expect(registered?.commandWindows).not.toContain("for /f");
      // The registration is project content: it survives a clone on any
      // machine, so it must never carry the installing machine's path.
      expect(JSON.stringify(config)).not.toContain(projectDir.path);
      expect(config.hooks).not.toHaveProperty("Stop");
    } finally {
      projectDir.cleanup();
    }
  });

  it("buildCodexProjectConfig merges without duplicating or mutating", () => {
    const commands = {
      entry: {
        command: "bash /p/entry.sh",
        commandWindows: "node /p/entry.mjs",
      },
    };
    const existing: CodexProjectConfig = {
      hooks: {
        SessionStart: [
          {
            hooks: [{ type: "command", command: "bash /other/entry.sh" }],
          },
        ],
      },
    };

    const merged = buildCodexProjectConfig(existing, commands);

    expect(existing.hooks?.SessionStart).toHaveLength(1);
    expect(merged.hooks?.SessionStart).toHaveLength(2);
    // The appended entry carries both forms: the host picks by platform.
    expect(merged.hooks?.SessionStart?.[1]?.hooks[0]).toEqual({
      type: "command",
      command: "bash /p/entry.sh",
      commandWindows: "node /p/entry.mjs",
    });
    expect(merged.hooks).not.toHaveProperty("Stop");
    // Serializing round-trips both fields, so the Windows override reaches
    // the config file instead of being dropped on write.
    const serialized = JSON.parse(
      serializeCodexProjectConfig(merged),
    ) as CodexProjectConfig;
    expect(serialized.hooks?.SessionStart?.[1]?.hooks[0]).toEqual({
      type: "command",
      command: "bash /p/entry.sh",
      commandWindows: "node /p/entry.mjs",
    });
  });
});
