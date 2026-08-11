import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { expect } from "vitest";

import { createTemporaryDirectory } from "../helpers/temp-directory.js";

export const CLI_PATH = join(process.cwd(), "dist", "cli.js");

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Spawns the built CLI in an isolated cwd (temp directory per test). */
export function runCli(
  args: readonly string[],
  cwd: string,
  input?: string,
): CliResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    input,
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function withTemporaryDirectory(callback: (cwd: string) => void): void {
  const temporary = createTemporaryDirectory();

  try {
    callback(temporary.path);
  } finally {
    temporary.cleanup();
  }
}

/** Runs `tc init` first and asserts it succeeded, then runs the callback. */
export function withInitializedDirectory(
  callback: (cwd: string) => void,
): void {
  withTemporaryDirectory((cwd) => {
    const init = runCli(["init"], cwd);
    expect(init.status).toBe(0);
    expect(init.stderr).toBe("");
    callback(cwd);
  });
}

export function parseJson<T>(result: CliResult): T {
  return JSON.parse(result.stdout) as T;
}
