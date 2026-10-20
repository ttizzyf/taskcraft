// Shared adapter machinery: sync probe/spawn seams, capability probing,
// idempotent hook installation and hook field tests. Codex and Claude
// adapters differ only in probe commands, config
// files and session formats; everything host-neutral lives here.

import { execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { BREADCRUMB_SCHEMA_VERSION } from "../core/breadcrumb.js";
import { entryGateTemplate, entryHookTemplate } from "./entry-scripts.js";
import { commandSpec, spawnCommand, terminateTree } from "./process.js";
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

export function defaultProbe(command: string, args: string[]): ProbeOutcome {
  const spec = commandSpec(command, args);

  try {
    const stdout = execFileSync(spec.file, spec.args, {
      encoding: "utf8",
      timeout: DEFAULT_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      ...(spec.verbatim ? { windowsVerbatimArguments: true } : {}),
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

/** Runs a host command under a hard timeout.
 *
 * The timeout must terminate the whole process tree, not just the direct
 * child: on Windows the command is launched through cmd.exe, so letting Node
 * kill only the direct child orphans the host that cmd.exe started and leaves
 * it running after the field test has already given up. */
export async function defaultSpawn(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; input?: string },
): Promise<SpawnOutcome> {
  let child: ChildProcess;
  try {
    child = spawnCommand(command, args, {
      cwd: options.cwd,
      stdio:
        options.input === undefined
          ? ["ignore", "pipe", "pipe"]
          : ["pipe", "pipe", "pipe"],
    });
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

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

  if (options.input === undefined) {
    child.stdin?.end();
  } else {
    child.stdin?.end(options.input);
  }

  let timedOut = false;
  let killFailure: string | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      terminateTree(child.pid, true);
    } catch (error) {
      // The tree kill failed, but the direct child still has to die: without
      // its `close` event the field test would hang instead of reporting the
      // timeout it already decided on.
      killFailure = describeError(error);
      child.kill("SIGKILL");
    }
  }, options.timeoutMs);

  const spawnError = await new Promise<Error | null>((resolve) => {
    child.once("error", resolve);
    child.once("close", () => resolve(null));
  });
  clearTimeout(timer);

  const captured = {
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };

  if (spawnError !== null) {
    return {
      ...captured,
      ok: false,
      exitCode: child.exitCode,
      timedOut,
      error: spawnError.message,
    };
  }

  if (timedOut) {
    return {
      ...captured,
      ok: false,
      exitCode: child.exitCode,
      timedOut: true,
      error: killFailure ?? `ETIMEDOUT: host exceeded ${options.timeoutMs}ms`,
    };
  }

  return {
    ...captured,
    ok: child.exitCode === 0,
    exitCode: child.exitCode,
    timedOut: false,
  };
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

/** The host whose registration file receives the command. */
export type HookHost = "codex" | "claude";

/** A registered hook command, with the host's own Windows-only override where
 * the host documents one. */
export interface HookCommand {
  command: string;
  commandWindows?: string;
}

/** The registered SessionStart command for a project.
 *
 * Hook handlers run in the session's current directory, which may be a
 * subdirectory, so a bare relative path such as `.taskcraft/hooks/entry.sh`
 * is not enough: the command needs a project-root anchor the host resolves
 * before any Taskcraft code runs. Each host is registered the way its own
 * documentation resolves repo-local hooks, so no registration embeds a path
 * from the machine that ran `tc init` — and none names the platform it was
 * generated on, so a committed registration works after a clone:
 *
 * - Claude Code supplies `${CLAUDE_PROJECT_DIR}`, documented as the way to
 *   reference a script "regardless of the working directory when the hook
 *   runs", and substitutes it itself rather than leaving it to a shell. Claude
 *   Code settings carry no Windows-specific override, so the shell-free Node
 *   gate is registered on every platform: a `bash` command would not survive
 *   the PowerShell a Windows session may run hooks in.
 * - Codex documents `$(git rev-parse --show-toplevel)` for repo-local hooks.
 *   It runs the command through the session's own shell, which on Windows is
 *   not necessarily cmd.exe — a Windows Codex session here executes hooks in
 *   PowerShell, where a cmd `for /f` rewrite is a parse error. `$(...)` is
 *   command substitution in PowerShell and in every POSIX shell, so both fields
 *   carry the documented anchor verbatim; only cmd.exe would need a different
 *   spelling, and no host is registered that way. Windows has no `bash`, so the
 *   Node gate is registered there. */
export function entryHookCommand(host: HookHost): HookCommand {
  if (host === "claude") {
    return {
      command: 'node "${CLAUDE_PROJECT_DIR}/.taskcraft/hooks/entry.mjs"',
    };
  }

  return {
    command:
      'bash "$(git rev-parse --show-toplevel)/.taskcraft/hooks/entry.sh"',
    commandWindows:
      'node "$(git rev-parse --show-toplevel)/.taskcraft/hooks/entry.mjs"',
  };
}

export interface HookCommands {
  entry: HookCommand;
}

export interface CommandHookEntry {
  hooks: Array<{ type: "command"; command: string; commandWindows?: string }>;
}

/** Appends a command handler using the lifecycle-hook shape shared by Codex
 * hooks.json and Claude settings.json. Both fields are compared: an entry that
 * carries the same `command` but a missing or stale Windows override is not the
 * same registration. */
export function appendCommandHook(
  existing: readonly CommandHookEntry[] | undefined,
  command: HookCommand,
): CommandHookEntry[] {
  const current = existing ?? [];

  return current.some((entry) =>
    entry.hooks.some(
      (hook) =>
        hook.command === command.command &&
        hook.commandWindows === command.commandWindows,
    ),
  )
    ? [...current]
    : [...current, { hooks: [{ type: "command", ...command }] }];
}

export interface InstallFilesOptions {
  /** Host whose registration file is written; selects the project-root anchor
   * used in the registered command. */
  host: HookHost;
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
  options: InstallFilesOptions,
): InstallResult {
  try {
    const hooksDir = join(input.projectDir, ".taskcraft", "hooks");
    const entryPath = join(hooksDir, "entry.sh");
    const gatePath = join(hooksDir, "entry.mjs");
    writeIfAbsent(entryPath, entryHookTemplate());
    writeIfAbsent(gatePath, entryGateTemplate());

    const configFile = join(input.projectDir, options.configPath);
    const commands: HookCommands = {
      entry: entryHookCommand(options.host),
    };

    // Existing project config is left untouched (write-if-absent), so the
    // hooks are NOT registered: an explicit failure, never a partial success.
    // The caller surfaces the remediation (merge manually / move the config
    // away and re-run init).
    if (existsSync(configFile)) {
      return {
        ok: false,
        hookPaths: [entryPath, gatePath],
        limitation: "config exists; hooks not registered",
      };
    }

    writeIfAbsent(configFile, options.freshConfig(commands));

    return { ok: true, hookPaths: [entryPath, gatePath] };
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
export async function runEntryHookTest(
  spawn: SpawnFn,
  now: () => string,
  hostCommand: string,
  hostArgs: string[],
  input: HookTestInput,
  inspectOutput: (stdout: string) => string | null = inspectEntryMarker,
): Promise<HookTestResult> {
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
  const host = await spawn(hostCommand, [...hostArgs, prompt], {
    cwd: input.projectDir,
    timeoutMs,
  });
  const failures = entryTestFailures(host, timeoutMs);
  if (failures.length === 0) {
    const outputFailure = inspectOutput(host.stdout);
    if (outputFailure !== null) failures.push(outputFailure);
  }
  const entryInjected = failures.length === 0;

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
function entryTestFailures(host: SpawnOutcome, timeoutMs: number): string[] {
  const failures: string[] = [];

  if (host.timedOut) {
    failures.push(`entry injection timed out after ${timeoutMs}ms`);
  } else if (host.error !== undefined) {
    failures.push(`host spawn failed: ${host.error}`);
  } else if (!host.ok) {
    failures.push(
      `host exited with code ${exitDetail(host.exitCode)}${stderrDetail(host.stderr)}`,
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

function inspectEntryMarker(stdout: string): string | null {
  return stdout.includes(BREADCRUMB_SCHEMA_VERSION)
    ? null
    : `entry injection: ${BREADCRUMB_SCHEMA_VERSION} missing from host output`;
}
