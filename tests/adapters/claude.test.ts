import { CLAUDE_ENTRY_STREAM } from "./claude-entry-fixture.js";
import { describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
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

import { createClaudeAdapter } from "../../src/adapters/claude.js";
import type { ClaudeSettings } from "../../src/adapters/claude.js";
import {
  buildClaudeProjectConfig,
  serializeClaudeSettings,
} from "../../src/adapters/claude.js";
import { createFakeHost } from "../helpers/fake-host.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";
import { runConformance } from "./conformance.js";

describe("claude adapter", () => {
  const fake = createFakeHost();

  runConformance((deps) => createClaudeAdapter(deps), fake, fsWriteLog);

  it("derives capabilities from claude-specific probe text", () => {
    fake.reset();
    fake.setProbeScript("claude", ["--version"], { stdout: "2.1.220\n" });
    fake.setProbeScript("claude", ["--help"], {
      stdout: "hooks, session ids, JSON Schema and budget supported\n",
    });

    const capabilities = createClaudeAdapter(fake.deps()).capabilities();

    expect(capabilities.version).toBe("2.1.220");
    expect(
      capabilities.items.find((item) => item.name === "session-start"),
    ).toMatchObject({
      available: true,
      limitation: expect.stringContaining("UserPromptSubmit"),
    });
    expect(
      capabilities.items.find((item) => item.name === "structured-output"),
    ).toMatchObject({ available: true });
    expect(
      capabilities.items.find((item) => item.name === "run-correlation"),
    ).toMatchObject({ available: true });
  });

  it("reports unavailable when the probe text lacks the keyword", () => {
    fake.reset();
    fake.setProbeScript("claude", ["--version"], { stdout: "2.1.220\n" });
    fake.setProbeScript("claude", ["--help"], { stdout: "minimal help\n" });

    const capabilities = createClaudeAdapter(fake.deps()).capabilities();

    expect(
      capabilities.items.find((item) => item.name === "session-start"),
    ).toMatchObject({ available: false });
    expect(
      capabilities.items.find((item) => item.name === "structured-output"),
    ).toMatchObject({
      available: false,
      limitation: expect.stringContaining("json schema"),
    });
  });

  it("testEntryHook spawns claude -p with the minimal prompt", () => {
    fake.reset();
    const projectDir = createTemporaryDirectory();
    const entryScript = join(
      projectDir.path,
      ".taskcraft",
      "hooks",
      "entry.sh",
    );
    fake.setSpawnScript("claude", {
      stdout: CLAUDE_ENTRY_STREAM,
    });

    try {
      const adapter = createClaudeAdapter(fake.deps());
      const result = adapter.testEntryHook({
        projectDir: projectDir.path,
        entryScript,
      });

      expect(result.ok).toBe(true);
      expect(result.entryInjected).toBe(true);
      const call = fake.calls.find(
        (entry) => entry.kind === "spawn" && entry.command === "claude",
      );
      expect(call?.command).toBe("claude");
      expect(call?.args[0]).toBe("-p");
      expect(call?.args).toEqual([
        "-p",
        "--include-hook-events",
        "--output-format",
        "stream-json",
        "--verbose",
        "--setting-sources",
        "user,project",
        "Reply exactly TC_FIRST.",
      ]);
      expect(call?.args).toContain("--setting-sources");
      expect(call?.args.at(-1)).toBe("Reply exactly TC_FIRST.");
    } finally {
      projectDir.cleanup();
    }
  });

  it("installEntry registers only SessionStart in .claude/settings.json", () => {
    const projectDir = createTemporaryDirectory();

    try {
      const adapter = createClaudeAdapter(fake.deps());
      const result = adapter.installEntry({
        projectDir: projectDir.path,
        takeOver: "ask",
      });

      expect(result.ok).toBe(true);
      const settings = JSON.parse(
        readFileSync(join(projectDir.path, ".claude", "settings.json"), "utf8"),
      ) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };
      expect(settings.hooks.SessionStart).toHaveLength(1);
      expect(settings.hooks.SessionStart?.[0]!.hooks[0]!.command).toContain(
        "entry.sh",
      );
      expect(settings.hooks.Stop).toBeUndefined();
    } finally {
      projectDir.cleanup();
    }
  });

  it("buildClaudeProjectConfig merges without duplicating or mutating", () => {
    const commands = { entry: "bash /p/entry.sh" };
    const existing: ClaudeSettings = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "bash /p/entry.sh" }] },
        ],
      },
    };

    const merged = buildClaudeProjectConfig(existing, commands);

    expect(merged.hooks?.SessionStart).toHaveLength(1);
    expect(existing.hooks?.SessionStart).toHaveLength(1);
    expect(serializeClaudeSettings(merged)).not.toContain("Stop");
    expect(serializeClaudeSettings(merged)).not.toContain("stop.sh");
  });
});
