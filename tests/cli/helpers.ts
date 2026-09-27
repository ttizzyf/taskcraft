import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

import { expect } from "vitest";

import { createTemporaryDirectory } from "../helpers/temp-directory.js";

export const CLI_PATH = join(process.cwd(), "dist", "cli.js");

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Spawns the built CLI in an isolated cwd (temp directory per test).
 *
 * Deliberately takes no stdin: `spawnSync` creates the stdin pipe eagerly, and
 * some Windows environments reject that extra pipe with EBUSY. The failure is
 * silent — `spawnSync` returns `{ status: null, stdout: undefined }` — so every
 * `expect(status).toBe(0)` degrades into `expected null to be 0` and the whole
 * CLI suite reports noise instead of results. Callers that really need stdin
 * must use `runCliWithStdin`, which spawns asynchronously. */
export function runCli(args: readonly string[], cwd: string): CliResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Async sibling of `runCli` for the few cases that must feed stdin.
 *
 * Uses async `spawn`, which builds the stdin pipe reliably where `spawnSync`
 * does not. The child's stdin is closed right after the write so the CLI sees
 * EOF instead of waiting forever. */
export function runCliWithStdin(
  args: readonly string[],
  cwd: string,
  input: string,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (child.stdout === null || child.stderr === null) {
      reject(new Error("expected the CLI to expose stdout and stderr"));
      return;
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });

    child.stdin.end(input);
  });
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

/** Async sibling of `withInitializedDirectory` for callbacks that await
 * `runCliWithStdin`. The temporary directory is cleaned up only after the
 * callback settles, so the store stays on disk for the whole test. */
export async function withInitializedDirectoryAsync(
  callback: (cwd: string) => Promise<void>,
): Promise<void> {
  const temporary = createTemporaryDirectory();

  try {
    const init = runCli(["init"], temporary.path);
    expect(init.status).toBe(0);
    expect(init.stderr).toBe("");
    await callback(temporary.path);
  } finally {
    temporary.cleanup();
  }
}

export function parseJson<T>(result: CliResult): T {
  return JSON.parse(result.stdout) as T;
}
