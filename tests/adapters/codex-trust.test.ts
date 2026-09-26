// Codex project-trust parsing. `~/.codex/config.toml` records trust as a
// `[projects.<path>]` table, and TOML gives that key two string forms: a basic
// string (`"C:\\Users\\me"`, where `\\` is one backslash) and a literal string
// (`'C:\Users\me'`, taken verbatim). Codex writes the literal form for Windows
// paths so the backslashes need no escaping — a parser that only understands
// the basic form reports a trusted project as untrusted, which makes the
// field test impossible to pass on Windows.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCodexAdapter } from "../../src/adapters/codex.js";
import { BREADCRUMB_LINE, createFakeHost } from "../helpers/fake-host.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

/** Runs the real field-test judgment against a user config holding `configText`
 * and reports whether the trust gate let it through. */
async function fieldTestPasses(
  projectDir: string,
  configText: string,
): Promise<boolean> {
  const userConfigPath = join(projectDir, "codex-user-config.toml");
  writeFileSync(userConfigPath, configText, "utf8");

  const fake = createFakeHost();
  fake.setProbeScript("codex", ["features", "list"], {
    stdout: "hooks stable true\n",
  });
  fake.setSpawnScript("codex", {
    stdout: `${BREADCRUMB_LINE}\nagent: TC_FIRST\n`,
  });

  const result = await createCodexAdapter({
    ...fake.deps(),
    userConfigPath,
  }).testEntryHook({
    projectDir,
    entryScript: join(projectDir, ".taskcraft", "hooks", "entry.sh"),
  });

  return result.ok;
}

function trustTable(path: string, quote: "'" | '"'): string {
  return `[projects.${quote}${path}${quote}]\ntrust_level = "trusted"\n`;
}

describe("codex project trust gate", () => {
  it("accepts the literal single-quoted table codex writes for Windows paths", async () => {
    const projectDir = createTemporaryDirectory();

    try {
      expect(
        await fieldTestPasses(
          projectDir.path,
          trustTable(projectDir.path, "'"),
        ),
      ).toBe(true);
    } finally {
      projectDir.cleanup();
    }
  });

  it("accepts a basic double-quoted table with escaped backslashes", async () => {
    const projectDir = createTemporaryDirectory();

    try {
      const escaped = projectDir.path.replaceAll("\\", "\\\\");
      expect(
        await fieldTestPasses(projectDir.path, trustTable(escaped, '"')),
      ).toBe(true);
    } finally {
      projectDir.cleanup();
    }
  });

  it("accepts a single-quoted trust_level value", async () => {
    const projectDir = createTemporaryDirectory();

    try {
      const config = `[projects.'${projectDir.path}']\ntrust_level = 'trusted'\n`;
      expect(await fieldTestPasses(projectDir.path, config)).toBe(true);
    } finally {
      projectDir.cleanup();
    }
  });

  it("rejects trust declared only for the parent directory", async () => {
    const projectDir = createTemporaryDirectory();

    try {
      const parent = dirname(projectDir.path);
      expect(
        await fieldTestPasses(projectDir.path, trustTable(parent, "'")),
      ).toBe(false);
    } finally {
      projectDir.cleanup();
    }
  });

  it("rejects a commented-out trust_level", async () => {
    const projectDir = createTemporaryDirectory();

    try {
      const config = `[projects.'${projectDir.path}']\n# trust_level = "trusted"\n`;
      expect(await fieldTestPasses(projectDir.path, config)).toBe(false);
    } finally {
      projectDir.cleanup();
    }
  });

  it("rejects a trust_level belonging to another project's table", async () => {
    const projectDir = createTemporaryDirectory();

    try {
      const config = `[projects.'/somewhere/else']\ntrust_level = "trusted"\n`;
      expect(await fieldTestPasses(projectDir.path, config)).toBe(false);
    } finally {
      projectDir.cleanup();
    }
  });

  it.runIf(process.platform === "win32")(
    "matches a Windows path despite the config's casing and separators",
    async () => {
      const projectDir = createTemporaryDirectory();

      try {
        // codex records its own casing; a slash-separated spelling must match too.
        const slashed = projectDir.path.replaceAll("\\", "/").toLowerCase();
        expect(
          await fieldTestPasses(projectDir.path, trustTable(slashed, "'")),
        ).toBe(true);
      } finally {
        projectDir.cleanup();
      }
    },
  );
});
