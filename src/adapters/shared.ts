// Shared adapter machinery: sync probe/spawn seams, capability probing,
// idempotent hook installation and hook field tests. Codex and Claude
// adapters differ only in probe commands, config
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
  const tokens = stdout.trim().split(/\s+/);
  const version = tokens.find((token) =>
    /^v?\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?$/.test(token),
  );
  const token = version ?? tokens[0];

  if (token === undefined || token.length === 0) {
    return null;
  }

  return token.startsWith("v") ? token.slice(1) : token;
}

function execStderr(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;

  return typeof stderr === "string" ? stderr : "";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The Entry wrapper delegates to the public CLI (`tc state --breadcrumb`).
 * The project root is derived from the script location, so the wrapper never
 * depends on cwd. */
export function entryHookTemplate(tcPath: string): string {
  return `#!/usr/bin/env bash
# Taskcraft managed entry hook gate (tc init --agent <host>).
cd "$(dirname "$0")/../.." || exit $?
taskcraft_output="$(node "${tcPath}" state --breadcrumb)"
taskcraft_status=$?
if [ "$taskcraft_status" -ne 0 ]; then
  exit "$taskcraft_status"
fi
if [ -n "$taskcraft_output" ]; then
  # A bare JSON object is interpreted as the host's hook control protocol.
  # Prefix the business breadcrumb so both Codex and Claude inject it as text.
  printf '%s\n' 'Taskcraft Entry context:' "$taskcraft_output"
fi
`;
}

export interface HookCommands {
  entry: string;
}

export interface CommandHookEntry {
  hooks: Array<{ type: "command"; command: string }>;
}

/** Appends a command handler using the lifecycle-hook shape shared by Codex
 * hooks.json and Claude settings.json. */
export function appendCommandHook(
  existing: readonly CommandHookEntry[] | undefined,
  command: string,
): CommandHookEntry[] {
  const current = existing ?? [];

  return current.some((entry) =>
    entry.hooks.some((hook) => hook.command === command),
  )
    ? [...current]
    : [...current, { hooks: [{ type: "command", command }] }];
}

export interface InstallFilesOptions {
  /** Project config path relative to projectDir (".codex/hooks.json" or
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
    writeIfAbsent(entryPath, entryHookTemplate(tcPath));

    const configFile = join(input.projectDir, options.configPath);
    const commands: HookCommands = {
      entry: `bash "${entryPath}"`,
    };

    // Existing project config is left untouched (write-if-absent), so the
    // hooks are NOT registered: an explicit failure, never a partial success.
    // The caller surfaces the remediation (merge manually / move the config
    // away and re-run init).
    if (existsSync(configFile)) {
      return {
        ok: false,
        hookPaths: [entryPath],
        limitation: "config exists; hooks not registered",
      };
    }

    writeIfAbsent(configFile, options.freshConfig(commands));

    return { ok: true, hookPaths: [entryPath] };
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

export function sampleOf(stdout: string): string {
  const trimmed = stdout.trim();

  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

/** Installed Entry Hook field test: spawns the host with the minimal prompt
 * (60s hard timeout). Nothing is installed or copied: the test runs the real
 * project registration and installed entry wrapper against the real Task
 * Store. The spawn seam is injectable for fake hosts. */
export function runEntryHookTest(
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
      testedAt,
      failure: gateFailure,
    };
  }

  const prompt = input.prompt ?? "Reply exactly TC_FIRST.";
  const host = spawn(hostCommand, [...hostArgs, prompt], {
    cwd: input.projectDir,
    timeoutMs,
  });
  const entryInjected =
    host.ok && host.stdout.includes(BREADCRUMB_SCHEMA_VERSION);
  const failures = entryTestFailures(host, entryInjected, timeoutMs);

  const result: HookTestResult = {
    ok: failures.length === 0,
    entryInjected,
    testedAt,
    sample: sampleOf(host.stdout),
  };

  if (failures.length > 0) {
    result.failure = `entry hook test failed: ${failures.join("; ")}`;
  }

  return result;
}

/** Collects the explicit reason for every failed judgment, so a partial
 * failure reports exactly which check failed instead of a vague "not ok". */
function entryTestFailures(
  host: SpawnOutcome,
  entryInjected: boolean,
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

  return failures;
}

function exitDetail(exitCode: number | null): string {
  return exitCode === null ? "no exit code" : String(exitCode);
}

function stderrDetail(stderr: string): string {
  const detail = stderr.trim();

  return detail.length > 0 ? `: ${detail}` : "";
}
