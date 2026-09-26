import { execFileSync, spawn, spawnSync } from "node:child_process";

import type {
  ChildProcess,
  ChildProcessWithoutNullStreams,
  ExecFileSyncOptions,
  SpawnOptions,
  SpawnOptionsWithStdioTuple,
  StdioPipe,
} from "node:child_process";

/** Windows cannot CreateProcess the `.cmd`/`.bat` shims npm installs (Node
 * raises EINVAL), and `shell: true` re-parses every argument through cmd.exe:
 * the JSON payloads (`--mcp-config`) lose their quotes and spaced tool
 * patterns (`Bash(tc *)`) arrive split in two. These helpers run the command
 * through `cmd.exe /d /s /c` with verbatim arguments instead, so the escaping
 * the caller built survives intact while `.cmd` shims still resolve. */
export const IS_WINDOWS = process.platform === "win32";

const CMD_SPECIALS = /[\s"&|<>^]/;

interface CommandSpec {
  file: string;
  args: string[];
  verbatim: boolean;
}

/** Spawns `command` with `args` preserved exactly on every platform. */
export function spawnCommand(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>,
): ChildProcessWithoutNullStreams;
export function spawnCommand(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess;
export function spawnCommand(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  const spec = commandSpec(command, args);
  return spawn(spec.file, spec.args, {
    ...options,
    // Windows terminates descendants with taskkill /T, so it needs neither a
    // process group nor cmd.exe's own argument quoting.
    ...(spec.verbatim
      ? { windowsVerbatimArguments: true, detached: false }
      : {}),
  });
}

/** Runs `command` synchronously and returns its stdout as text. */
export function execFileCommand(
  command: string,
  args: readonly string[],
  options: ExecFileSyncOptions & { encoding: BufferEncoding },
): string {
  const spec = commandSpec(command, args);
  return execFileSync(spec.file, spec.args, {
    ...options,
    ...(spec.verbatim ? { windowsVerbatimArguments: true } : {}),
  });
}

/** Terminates the process tree rooted at `pid`.
 *
 * POSIX signals the detached group through the negative pid, so every
 * descendant the session spawned dies with it; Windows walks the tree with
 * `taskkill /T`, which can only force-terminate console processes. A tree
 * that has already exited is not a failure, but every other failure is
 * thrown so the caller records it instead of assuming the interruption worked.
 */
export function terminateTree(pid: number, force: boolean): void {
  if (!IS_WINDOWS) {
    try {
      process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
    } catch (error) {
      if (errnoCode(error) !== "ESRCH") throw error;
    }
    return;
  }
  const killed = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (killed.error !== undefined) throw killed.error;
  if (killed.status === 0 || !processExists(pid)) return;
  throw new Error(
    `taskkill /PID ${String(pid)} /T /F exited ${String(killed.status)}: ${(killed.stderr ?? "").trim().replace(/\s+/g, " ")}`,
  );
}

function commandSpec(command: string, args: readonly string[]): CommandSpec {
  if (!IS_WINDOWS) return { file: command, args: [...args], verbatim: false };
  const line = [command, ...args.map(quoteArgument)].join(" ");
  return {
    file: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", line],
    verbatim: true,
  };
}

/** Quotes one argument for a cmd.exe command line. Verbatim arguments are
 * parsed by cmd.exe and then by the target's CRT: a quoted run keeps its
 * spaces together and `\"` survives as a literal quote. */
function quoteArgument(value: string): string {
  // An unquoted empty argument vanishes from the cmd.exe command line and
  // shifts every later flag: `--tools ""` would swallow the following
  // `--model`, leaving the model grader on the host default.
  if (value === "") return '""';
  if (!CMD_SPECIALS.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}
