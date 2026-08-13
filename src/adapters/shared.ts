// Shared adapter machinery: sync probe/spawn seams, capability probing,
// idempotent hook installation, hook field test, and agent_runs observation
// writes. Codex and Claude adapters differ only in probe commands, config
// files and session formats; everything host-neutral lives here.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BREADCRUMB_SCHEMA_VERSION } from "../core/breadcrumb.js";
import type {
  AdapterCapabilities,
  AdapterCapabilityItem,
  CapabilityProbe,
  HookTestInput,
  HookTestResult,
  InstallInput,
  InstallResult,
  ProbeFn,
  ProbeOutcome,
  SpawnFn,
  SpawnOutcome,
} from "./types.js";

export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;
export const DEFAULT_HOOK_TEST_TIMEOUT_MS = 60_000;

/** Resolves the tc CLI entry from the module location so hook templates and
 * registrations never depend on cwd. dist/adapters -> dist/cli.js (one
 * parent hop; "../../" would land on the package root). */
export function resolveTcPath(): string {
  return fileURLToPath(new URL("../cli.js", import.meta.url));
}

export function defaultProbe(command: string, args: string[]): ProbeOutcome {
  try {
    const stdout = execFileSync(command, args, {
      encoding: "utf8",
      timeout: DEFAULT_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "" };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: execStderr(error),
      error: describeError(error),
    };
  }
}

export function defaultSpawn(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; input?: string },
): SpawnOutcome {
  try {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: options.timeoutMs,
      killSignal: "SIGKILL",
      input: options.input ?? undefined,
      stdio:
        options.input === undefined
          ? ["ignore", "pipe", "pipe"]
          : ["pipe", "pipe", "pipe"],
    });
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    const error = result.error;

    if (error !== undefined) {
      return {
        ok: false,
        stdout,
        stderr,
        exitCode: result.status,
        timedOut: error.message.includes("ETIMEDOUT"),
        error: error.message,
      };
    }

    return {
      ok: result.status === 0,
      stdout,
      stderr,
      exitCode: result.status,
      timedOut: false,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: false,
      error: describeError(error),
    };
  }
}

/** Capabilities never crash the command: any thrown probe becomes an
 * explicit unavailable item with the failure reason. */
export function safeProbe(
  probe: ProbeFn,
  command: string,
  args: string[],
): ProbeOutcome {
  try {
    return probe(command, args);
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      error: describeError(error),
    };
  }
}

/** Runs the read-only probes and derives the capability items. A failed
 * version probe invalidates every item; a failed document probe does the
 * same (no assumption without local evidence). */
export function probeCapabilities(
  probe: ProbeFn,
  host: string,
  versionArgs: string[],
  documentArgSets: readonly string[][],
  capabilityProbes: readonly CapabilityProbe[],
): AdapterCapabilities {
  const versionOutcome = safeProbe(probe, host, versionArgs);
  const version = tokenOrNull(versionOutcome.stdout);

  if (!versionOutcome.ok) {
    return {
      host,
      version,
      items: unavailableItems(capabilityProbes, probeFailure(versionOutcome)),
    };
  }

  const documentOutcomes = documentArgSets.map((args) =>
    safeProbe(probe, host, args),
  );
  const failedDocument = documentOutcomes.find((outcome) => !outcome.ok);

  if (failedDocument !== undefined) {
    return {
      host,
      version,
      items: unavailableItems(capabilityProbes, probeFailure(failedDocument)),
    };
  }

  const text = documentOutcomes.map((outcome) => outcome.stdout).join("\n");
  const lowered = text.toLowerCase();

  return {
    host,
    version,
    items: capabilityProbes.map((probeDef) => {
      const matched = probeDef.keywords.some((keyword) =>
        lowered.includes(keyword.toLowerCase()),
      );

      if (matched) {
        return probeDef.note === undefined
          ? { name: probeDef.name, available: true }
          : { name: probeDef.name, available: true, limitation: probeDef.note };
      }

      return {
        name: probeDef.name,
        available: false,
        limitation: `local probe text did not mention: ${probeDef.keywords.join(", ")}`,
      };
    }),
  };
}

function unavailableItems(
  probeDefs: readonly CapabilityProbe[],
  limitation: string,
): AdapterCapabilityItem[] {
  return probeDefs.map((probeDef) => ({
    name: probeDef.name,
    available: false,
    limitation,
  }));
}

function probeFailure(outcome: ProbeOutcome): string {
  const stderr = outcome.stderr.trim();
  return stderr.length > 0 ? stderr : (outcome.error ?? "probe failed");
}

function tokenOrNull(stdout: string): string | null {
  const token = stdout.trim().split(/\s+/)[0];

  return token === undefined || token.length === 0 ? null : token;
}

function execStderr(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;

  return typeof stderr === "string" ? stderr : "";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Hook script templates: thin bash wrappers around the compiled gate entry
 * points (dist/hooks/*.js). The config path is derived from the script
 * location, so neither wrapper nor gate depends on cwd. */
export function entryHookTemplate(tcPath: string): string {
  return hookTemplate(join(dirname(tcPath), "hooks", "entry.js"));
}

export function stopHookTemplate(tcPath: string): string {
  return hookTemplate(join(dirname(tcPath), "hooks", "stop.js"));
}

function hookTemplate(scriptPath: string): string {
  return `#!/usr/bin/env bash
# Taskcraft managed hook gate (tc init --agent <host>).
node "${scriptPath}" "$(dirname "$0")/../config.json"
`;
}

export interface HookCommands {
  entry: string;
  stop: string;
}

export interface InstallFilesOptions {
  /** Project config path relative to projectDir (".codex/config.toml" or
   * ".claude/settings.json"). */
  configPath: string;
  /** Serialized fresh project config for a first install. */
  freshConfig: (commands: HookCommands) => string;
}

/** Writes the hook scripts and the project config, both write-if-absent:
 * repeated calls never overwrite existing content and never duplicate
 * registrations. Only files under projectDir are touched. */
export function installEntryFiles(
  input: InstallInput,
  tcPath: string,
  options: InstallFilesOptions,
): InstallResult {
  try {
    const hooksDir = join(input.projectDir, ".taskcraft", "hooks");
    const entryPath = join(hooksDir, "entry.sh");
    const stopPath = join(hooksDir, "stop.sh");
    writeIfAbsent(entryPath, entryHookTemplate(tcPath));
    writeIfAbsent(stopPath, stopHookTemplate(tcPath));

    const configFile = join(input.projectDir, options.configPath);
    const commands: HookCommands = {
      entry: `bash "${entryPath}"`,
      stop: `bash "${stopPath}"`,
    };

    // Existing project config is left untouched (write-if-absent), so the
    // hooks are NOT registered: an explicit failure, never a partial success.
    // The caller surfaces the remediation (merge manually / move the config
    // away and re-run init).
    if (existsSync(configFile)) {
      return {
        ok: false,
        hookPaths: [entryPath, stopPath],
        limitation: "config exists; hooks not registered",
      };
    }

    writeIfAbsent(configFile, options.freshConfig(commands));

    return { ok: true, hookPaths: [entryPath, stopPath] };
  } catch (error) {
    return {
      ok: false,
      hookPaths: [],
      limitation: describeError(error),
    };
  }
}

function writeIfAbsent(path: string, content: string): void {
  if (existsSync(path)) {
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o755 });
}

/** Appends a hook command without duplicating an existing identical one. */
export function appendCommand(
  existing: readonly { command: string }[] | undefined,
  command: string,
): Array<{ command: string }> {
  const current = existing ?? [];

  return current.some((hook) => hook.command === command)
    ? [...current]
    : [...current, { command }];
}

export function sampleOf(stdout: string): string {
  const trimmed = stdout.trim();

  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

/** Installed-hooks field test: spawns the host with the minimal prompt (60s
 * hard timeout) and exercises the installed stop wrapper for the block and
 * loop-guard judgments. Nothing is installed or copied: the test runs the
 * real .taskcraft/hooks/ scripts against the real Task Store and project
 * config, and the breadcrumb is judged by the tc-breadcrumb/v1 JSON presence
 * in the host output. The spawn seam is injectable for fake hosts. */
export function runHookTest(
  spawn: SpawnFn,
  now: () => string,
  hostCommand: string,
  hostArgs: string[],
  input: HookTestInput,
): HookTestResult {
  const timeoutMs = input.timeoutMs ?? DEFAULT_HOOK_TEST_TIMEOUT_MS;
  const testedAt = now();
  const gateFailure = input.gate?.() ?? null;

  if (gateFailure !== null) {
    return {
      ok: false,
      entryInjected: false,
      stopBlocked: false,
      loopGuardOk: false,
      enforced: false,
      testedAt,
      failure: gateFailure,
    };
  }

  const prompt = input.prompt ?? "Reply exactly TC_FIRST.";
  const host = spawn(hostCommand, [...hostArgs, prompt], {
    cwd: input.projectDir,
    timeoutMs,
  });
  const stop = spawn("bash", [input.stopScript], {
    cwd: input.projectDir,
    timeoutMs,
  });
  const loop = spawn("bash", [input.stopScript], {
    cwd: input.projectDir,
    timeoutMs,
    input: '{"stop_hook_active":true}',
  });

  const entryInjected =
    host.ok && host.stdout.includes(BREADCRUMB_SCHEMA_VERSION);
  const stopBlocked =
    stop.exitCode === 2 && stop.stdout.includes(BREADCRUMB_SCHEMA_VERSION);
  const loopGuardOk = loop.exitCode === 0;
  const failures = testFailures(
    host,
    stop,
    loop,
    entryInjected,
    stopBlocked,
    loopGuardOk,
    timeoutMs,
  );

  const result: HookTestResult = {
    ok: failures.length === 0,
    entryInjected,
    stopBlocked,
    loopGuardOk,
    enforced: entryInjected && stopBlocked && loopGuardOk,
    testedAt,
    sample: sampleOf(host.stdout),
  };

  if (failures.length > 0) {
    result.failure = `hook test failed: ${failures.join("; ")}`;
  }

  return result;
}

/** Collects the explicit reason for every failed judgment, so a partial
 * failure reports exactly which check failed instead of a vague "not ok". */
function testFailures(
  host: SpawnOutcome,
  stop: SpawnOutcome,
  loop: SpawnOutcome,
  entryInjected: boolean,
  stopBlocked: boolean,
  loopGuardOk: boolean,
  timeoutMs: number,
): string[] {
  const failures: string[] = [];

  if (host.timedOut) {
    failures.push(`entry injection timed out after ${timeoutMs}ms`);
  } else if (host.error !== undefined) {
    failures.push(`host spawn failed: ${host.error}`);
  } else if (!host.ok) {
    failures.push(
      `host exited with code ${exitDetail(host.exitCode)}${stderrDetail(host.stderr)}`,
    );
  } else if (!entryInjected) {
    failures.push(
      `entry injection: ${BREADCRUMB_SCHEMA_VERSION} missing from host output`,
    );
  }

  if (stop.error !== undefined) {
    failures.push(`stop hook spawn failed: ${stop.error}`);
  } else if (stop.exitCode !== 2) {
    failures.push(
      `stop hook did not block: expected exit 2, got ${exitDetail(stop.exitCode)}${stderrDetail(stop.stderr)}`,
    );
  } else if (!stopBlocked) {
    failures.push(
      `stop hook blocked without the ${BREADCRUMB_SCHEMA_VERSION} breadcrumb`,
    );
  }

  if (loop.error !== undefined) {
    failures.push(`loop guard spawn failed: ${loop.error}`);
  } else if (loop.exitCode !== 0) {
    failures.push(
      `loop guard did not allow the re-entry: expected exit 0, got ${exitDetail(loop.exitCode)}${stderrDetail(loop.stderr)}`,
    );
  }

  return failures;
}

function exitDetail(exitCode: number | null): string {
  return exitCode === null ? "no exit code" : String(exitCode);
}

function stderrDetail(stderr: string): string {
  const detail = stderr.trim();

  return detail.length > 0 ? `: ${detail}` : "";
}
