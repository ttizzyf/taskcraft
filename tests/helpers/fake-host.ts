// Programmable fake host for adapter tests: the probe seam answers per
// command+args, the spawn seam per command, and every call is recorded.
// Nothing here executes a real host binary.

import type {
  AdapterDeps,
  ProbeOutcome,
  SpawnOutcome,
} from "../../src/adapters/types.js";

export const FIXED_NOW = "2026-08-12T00:00:00.000Z";

export interface FakeScript {
  stdout?: string;
  stderr?: string;
  /** Non-zero exit code; absent means 0. */
  exitCode?: number;
  /** Simulates the spawnSync timeout branch. */
  timedOut?: boolean;
}

export interface FakeCall {
  kind: "probe" | "spawn";
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface FakeHost {
  /** Adapter deps wired to this fake. Every call returns a fresh object so
   * multiple adapters can share one fake. */
  deps(): AdapterDeps;
  setProbeScript(command: string, args: string[], script: FakeScript): void;
  setSpawnScript(command: string, script: FakeScript): void;
  calls: FakeCall[];
  reset(): void;
}

const DEFAULT_PROBE: FakeScript = { stdout: "" };
const DEFAULT_SPAWN: FakeScript = { stdout: "" };

export function createFakeHost(): FakeHost {
  const probeScripts = new Map<string, FakeScript>();
  const spawnScripts = new Map<string, FakeScript>();
  const calls: FakeCall[] = [];

  const probeKey = (command: string, args: string[]): string =>
    `${command} ${args.join(" ")}`;

  const probe = (command: string, args: string[]): ProbeOutcome => {
    calls.push({ kind: "probe", command, args });
    const script = probeScripts.get(probeKey(command, args)) ?? DEFAULT_PROBE;
    const failed = script.exitCode !== undefined && script.exitCode !== 0;

    if (failed || script.timedOut === true) {
      return {
        ok: false,
        stdout: script.stdout ?? "",
        stderr: script.stderr ?? "",
        error: `fake probe failed for ${command}`,
      };
    }

    return { ok: true, stdout: script.stdout ?? "", stderr: "" };
  };

  const spawn = (
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number },
  ): SpawnOutcome => {
    calls.push({
      kind: "spawn",
      command,
      args,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
    });
    const script = spawnScripts.get(command) ?? DEFAULT_SPAWN;
    const stdout = script.stdout ?? "";
    const stderr = script.stderr ?? "";

    if (script.timedOut === true) {
      return {
        ok: false,
        stdout,
        stderr,
        exitCode: null,
        timedOut: true,
        error: `fake host timed out for ${command}`,
      };
    }

    const exitCode = script.exitCode ?? 0;

    return { ok: exitCode === 0, stdout, stderr, exitCode, timedOut: false };
  };

  return {
    deps: () => ({ probe, spawn, now: () => FIXED_NOW }),
    setProbeScript: (command, args, script) => {
      probeScripts.set(probeKey(command, args), script);
    },
    setSpawnScript: (command, script) => {
      spawnScripts.set(command, script);
    },
    calls,
    reset: () => {
      probeScripts.clear();
      spawnScripts.clear();
      calls.length = 0;
    },
  };
}

/** Shared capability-document text: contains every keyword both adapters
 * probe for, so the same probe output proves the shared contract. */
export const CAPABILITY_DOCUMENT_TEXT = [
  "Taskcraft capabilities: hooks are stable, session ids supported,",
  "JSON Schema available, output schema supported, resume works,",
  "thread correlation observed.",
].join("\n");
