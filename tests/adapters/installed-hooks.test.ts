// The pre-flight check `tc agent test-entry-hook` runs before it spends a host
// run: the installed Entry wrapper must exist and must actually reach a CLI.
// The managed wrappers resolve the CLI from the project root and fall back to a
// PATH install, so the check is asserted against the wrappers `tc init` really
// writes — not against a hand-written fixture, which is what let a wrapper
// whose CLI resolution had changed silently fail the check.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { entryGateTemplate } from "../../src/adapters/entry-scripts.js";
import { createCodexAdapter } from "../../src/adapters/codex.js";
import { checkInstalledScripts } from "../../src/adapters/installed-hooks.js";
import { entryHookCommand } from "../../src/adapters/shared.js";
import { ERROR_CODES, TaskcraftError } from "../../src/core/errors.js";
import { entryWrapperName } from "../helpers/entry-wrapper.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

/** Installs the real wrappers the way `tc init --agent codex` does. */
function installEntry(projectDir: string): void {
  const result = createCodexAdapter().installEntry({
    projectDir,
    takeOver: "ask",
  });

  expect(result.ok).toBe(true);
}

/** A project-local CLI, so the check never depends on a global `tc`. */
function writeLocalCli(projectDir: string, source = ""): void {
  const cli = join(projectDir, "dist", "cli.js");

  mkdirSync(join(projectDir, "dist"), { recursive: true });
  writeFileSync(cli, source, "utf8");
}

/** The PowerShell that runs a Windows hook command: `pwsh` when installed,
 * otherwise the Windows PowerShell that ships with the OS. */
function powershell(): string {
  for (const candidate of ["pwsh", "powershell.exe"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "exit 0"], {
      stdio: "ignore",
    });

    if (probe.status === 0) return candidate;
  }

  return "pwsh";
}

function expectHookCheckFailure(
  projectDir: string,
  fragment: string,
  findOnPath: () => string | null,
): void {
  try {
    checkInstalledScripts(projectDir, { findOnPath });
    throw new Error("expected TC_ADAPTER_HOOK_TEST_FAILED");
  } catch (error) {
    expect(error).toBeInstanceOf(TaskcraftError);
    expect((error as TaskcraftError).code).toBe(
      ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED,
    );
    expect((error as TaskcraftError).problem).toContain(fragment);
  }
}

describe("checkInstalledScripts", () => {
  it("accepts the wrappers tc init installs when the project has a local CLI", () => {
    const projectDir = createTemporaryDirectory();

    try {
      installEntry(projectDir.path);
      writeLocalCli(projectDir.path);

      // No PATH lookup is allowed to rescue this: the project-local candidate
      // has to be the one that satisfies the check.
      const scripts = checkInstalledScripts(projectDir.path, {
        findOnPath: () => null,
      });

      expect(scripts.entryScript).toBe(
        join(projectDir.path, ".taskcraft", "hooks", entryWrapperName()),
      );
    } finally {
      projectDir.cleanup();
    }
  });

  it("accepts a project whose CLI comes from the managed wrappers' PATH fallback", () => {
    const projectDir = createTemporaryDirectory();

    try {
      installEntry(projectDir.path);

      expect(() =>
        checkInstalledScripts(projectDir.path, {
          findOnPath: () => "/usr/local/bin/tc",
        }),
      ).not.toThrow();
    } finally {
      projectDir.cleanup();
    }
  });

  it("accepts a consumer project whose CLI is only under node_modules", () => {
    const projectDir = createTemporaryDirectory();

    try {
      installEntry(projectDir.path);
      const cli = join(
        projectDir.path,
        "node_modules",
        "taskcraft",
        "dist",
        "cli.js",
      );

      mkdirSync(dirname(cli), { recursive: true });
      writeFileSync(cli, "", "utf8");

      expect(() =>
        checkInstalledScripts(projectDir.path, { findOnPath: () => null }),
      ).not.toThrow();
    } finally {
      projectDir.cleanup();
    }
  });

  it("fails when the managed wrapper resolves no CLI at all", () => {
    const projectDir = createTemporaryDirectory();

    try {
      installEntry(projectDir.path);

      expectHookCheckFailure(
        projectDir.path,
        "resolves no gate artifact",
        () => null,
      );
    } finally {
      projectDir.cleanup();
    }
  });

  it("fails on a wrapper that names a missing absolute target", () => {
    const projectDir = createTemporaryDirectory();

    try {
      const hooksDir = join(projectDir.path, ".taskcraft", "hooks");

      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(
        join(hooksDir, "entry.sh"),
        '#!/usr/bin/env bash\nnode "/nonexistent/entry.js" "$(dirname "$0")/../config.json"\n',
        { mode: 0o755 },
      );

      expectHookCheckFailure(
        projectDir.path,
        "missing gate artifact",
        () => null,
      );
    } finally {
      projectDir.cleanup();
    }
  });

  it("fails when the platform wrapper is not installed", () => {
    const projectDir = createTemporaryDirectory();

    try {
      expectHookCheckFailure(
        projectDir.path,
        "Installed hook script is missing",
        () => null,
      );
    } finally {
      projectDir.cleanup();
    }
  });
});

describe("codex Windows registration", () => {
  it.runIf(process.platform === "win32")(
    "resolves the git-root anchor in the session shell and runs the gate",
    () => {
      const projectDir = createTemporaryDirectory();

      try {
        installEntry(projectDir.path);
        // The gate's output is only reachable through the project CLI, so a
        // token from here proves the whole chain ran.
        writeLocalCli(projectDir.path, 'console.log("TC_PROBE");\n');
        execFileSync("git", ["init", "-q"], {
          cwd: projectDir.path,
          stdio: "ignore",
        });

        const commandWindows = entryHookCommand("codex").commandWindows ?? "";
        // Launched the way the host launches it: the session's shell with
        // PowerShell's non-interactive flags.
        const result = spawnSync(
          powershell(),
          ["-NoProfile", "-NonInteractive", "-Command", commandWindows],
          {
            cwd: projectDir.path,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toContain("TC_PROBE");
      } finally {
        projectDir.cleanup();
      }
    },
  );
});

describe("managed wrapper PATH fallback", () => {
  it.runIf(process.platform === "win32")(
    "reaches a global tc through the command interpreter",
    () => {
      const projectDir = createTemporaryDirectory();
      const binDir = createTemporaryDirectory();

      try {
        const hooksDir = join(projectDir.path, ".taskcraft", "hooks");

        mkdirSync(hooksDir, { recursive: true });
        writeFileSync(join(hooksDir, "entry.mjs"), entryGateTemplate(), "utf8");
        // npm installs a global CLI as a `.cmd` shim, and CreateProcess cannot
        // run one, so the gate has to go through the command interpreter.
        writeFileSync(
          join(binDir.path, "tc.cmd"),
          "@echo TC_FALLBACK\r\n",
          "utf8",
        );

        const result = spawnSync(
          process.execPath,
          [join(hooksDir, "entry.mjs")],
          {
            cwd: projectDir.path,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${binDir.path}${delimiter}${process.env.PATH ?? ""}`,
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toContain("TC_FALLBACK");
      } finally {
        projectDir.cleanup();
        binDir.cleanup();
      }
    },
  );
});
