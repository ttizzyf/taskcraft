// Programmable fake host for adapter tests: the probe seam answers per
// command+args, the spawn seam per command (optionally per args+input, so the
// stop-block and loop-guard bash spawns of the same wrapper can be scripted
// separately), and every call is recorded. Nothing here executes a real host
// binary.

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

/** Narrower script matching for spawns: an exact args/input match wins over
 * the command-only default, so one wrapper can answer differently for the
 * plain call and the `stop_hook_active=true` re-entry call. */
export interface SpawnScriptMatch {
  args?: string[];
  input?: string;
}

export interface FakeCall {
  kind: "probe" | "spawn";
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  input?: string;
}

export interface FakeHost {
  /** Adapter deps wired to this fake. Every call returns a fresh object so
   * multiple adapters can share one fake. */
  deps(): AdapterDeps;
  setProbeScript(command: string, args: string[], script: FakeScript): void;
  setSpawnScript(
    command: string,
    script: FakeScript,
    match?: SpawnScriptMatch,
  ): void;
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

  const spawn = async (
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; input?: string },
  ): Promise<SpawnOutcome> => {
    calls.push({
      kind: "spawn",
      command,
      args,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      ...(options.input === undefined ? {} : { input: options.input }),
    });
    const script =
      spawnScripts.get(spawnKey(command, args, options.input)) ??
      spawnScripts.get(`${command}||`) ??
      DEFAULT_SPAWN;
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
    setSpawnScript: (command, script, match) => {
      spawnScripts.set(
        spawnKey(command, match?.args ?? [], match?.input),
        script,
      );
    },
    calls,
    reset: () => {
      probeScripts.clear();
      spawnScripts.clear();
      calls.length = 0;
    },
  };
}

function spawnKey(
  command: string,
  args: readonly string[],
  input: string | undefined,
): string {
  return `${command}|${args.join(" ")}|${input ?? ""}`;
}

/** Shared capability-document text: contains every keyword both adapters
 * probe for, so the same probe output proves the shared contract. */
export const CAPABILITY_DOCUMENT_TEXT = [
  "Taskcraft capabilities: hooks are stable, session ids supported,",
  "JSON Schema available, output schema supported, resume works,",
  "thread correlation observed.",
].join("\n");

/** Minimal tc-breadcrumb/v1 JSON line a fake host echoes once the installed
 * SessionStart hook injected the breadcrumb (entry judgment). */
export const BREADCRUMB_LINE =
  '{"schemaVersion":"tc-breadcrumb/v1","takeover":"active","task":{"id":"T-1","status":"active"},"next":{"command":"tc run complete T-1"}}';
