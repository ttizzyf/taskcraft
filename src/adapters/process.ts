// Cross-platform launch of the host CLI (`codex`, `claude`). Windows cannot
// CreateProcess the `.cmd` shims npm installs for those commands — Node raises
// EINVAL for a `.cmd` path — and a bare command name resolves to the
// extensionless POSIX shim next to it, which CreateProcess rejects with
// ENOENT because it only ever appends `.exe`. `shell: true` would resolve the
// shim but re-parses every argument through cmd.exe, so a prompt containing
// spaces arrives split into several arguments. These helpers run the command
// through `cmd.exe /d /s /c` with verbatim arguments instead: the `.cmd` shim
// resolves and every argument survives exactly as the caller built it.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";

export const IS_WINDOWS = process.platform === "win32";

/** cmd.exe metacharacters that force an argument to be quoted. */
const CMD_SPECIALS = /[\s"&|<>^]/;

export interface CommandSpec {
  /** The executable to hand to child_process. */
  file: string;
  args: string[];
  /** True when the args must bypass Node's own cmd.exe quoting. */
  verbatim: boolean;
}

/** Splits a host command into the file to launch plus its argument list.
 * POSIX launches the command directly; Windows routes it through cmd.exe so
 * npm's `.cmd` shims resolve, with `verbatim` telling child_process not to
 * re-quote the line. The platform is injectable so both branches are testable
 * from either host. */
export function commandSpec(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): CommandSpec {
  if (platform !== "win32") {
    return { file: command, args: [...args], verbatim: false };
  }

  const line = [command, ...args.map(quoteArgument)].join(" ");

  return {
    file: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", line],
    verbatim: true,
  };
}

/** Launches a host command so its arguments survive intact on every platform.
 * `detached` is not taken from `options`: POSIX needs its own process group so
 * `terminateTree` can signal the whole tree, and Windows must stay attached
 * because a detached console flashes a window (it walks the tree with
 * taskkill instead). */
export function spawnCommand(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess {
  const spec = commandSpec(command, args);

  return spawn(spec.file, spec.args, {
    ...options,
    detached: !IS_WINDOWS,
    ...(spec.verbatim ? { windowsVerbatimArguments: true } : {}),
  });
}

/** Terminates the process tree rooted at `pid`.
 *
 * POSIX signals the child's own process group through the negative pid so
 * descendants die with it, and falls back to the direct child when no such
 * group exists. Windows walks the tree with `taskkill /T`, which only reaches
 * console processes.
 *
 * This must run while `pid` is still alive. `taskkill /T` resolves the tree
 * from the live process table, so once the root has exited its children are
 * unreachable — `taskkill /PID <dead-pid> /T /F` exits 128 with "process not
 * found" and the orphan keeps running. Callers that let Node terminate the
 * direct child first (a synchronous `spawnSync`/`execFileSync` timeout) have
 * therefore already lost the tree and cannot recover it here.
 *
 * A tree that has already exited is not a failure; every other failure is
 * thrown so the caller records it instead of assuming the kill worked.
 */
export function terminateTree(pid: number | undefined, force: boolean): void {
  if (pid === undefined) return;

  if (!IS_WINDOWS) {
    const signal: NodeJS.Signals = force ? "SIGKILL" : "SIGTERM";
    if (signalGroup(pid, signal)) return;
    signalProcess(pid, signal);
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

/** Signals the process group led by `pid`. Returns false when no such group
 * exists (the child was not spawned detached). */
function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (errnoCode(error) !== "ESRCH") throw error;
    return false;
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (errnoCode(error) !== "ESRCH") throw error;
  }
}

/** Quotes one argument for a cmd.exe command line. Verbatim arguments are
 * parsed by cmd.exe and then by the target's own parser: a quoted run keeps
 * its spaces together and `\"` survives as a literal quote. */
function quoteArgument(value: string): string {
  // An unquoted empty argument vanishes from the cmd.exe command line and
  // shifts every later flag, silently changing which flags the host sees.
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
