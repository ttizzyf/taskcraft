// Shared adapter machinery: sync probe/spawn seams, capability probing,
// idempotent hook installation, hook field test, and agent_runs observation
// writes. Codex and Claude adapters differ only in probe commands, config
// files and session formats; everything host-neutral lives here.

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withTransaction } from "../store/transaction.js";
import type { TaskcraftDatabase } from "../store/database.js";
import type {
  AdapterCapabilities,
  AdapterCapabilityItem,
  AttachInput,
  CapabilityProbe,
  HookTestInput,
  HookTestResult,
  HostRun,
  InstallInput,
  InstallResult,
  ProbeFn,
  ProbeOutcome,
  RuntimeObservation,
  SpawnFn,
  SpawnOutcome,
} from "./types.js";

export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;
export const DEFAULT_HOOK_TEST_TIMEOUT_MS = 60_000;

/** Entry hook marker echoed by the temporary test session when the entry
 * hook fires; Stop markers carry the block/allow decision. */
export const ENTRY_MARKER = "TC_ENTRY_INJECTED";
export const STOP_BLOCK_MARKER = "TC_STOP_BLOCK";
export const STOP_ALLOW_MARKER = "TC_STOP_ALLOW";

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
  options: { cwd: string; timeoutMs: number },
): SpawnOutcome {
  try {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: options.timeoutMs,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "pipe"],
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

    // Existing project config is left untouched (write-if-absent); surface
    // the partial success so users know the hooks are not registered yet.
    if (existsSync(configFile)) {
      return {
        ok: true,
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

export interface HookTestParse {
  entryInjected: boolean;
  stopEnforced: boolean;
}

export function parseHookTestOutput(stdout: string): HookTestParse {
  return {
    entryInjected: stdout.includes(ENTRY_MARKER),
    stopEnforced: stdout.includes(STOP_BLOCK_MARKER),
  };
}

export function sampleOf(stdout: string): string {
  const trimmed = stdout.trim();

  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

/** Writes the minimal hook-test session into the temp directory and spawns
 * the host with the minimal prompt. A 60s hard timeout (spawnSync) plus
 * explicit failure results; the spawn seam is injectable for fake hosts. */
export function runHookTest(
  spawn: SpawnFn,
  now: () => string,
  hostCommand: string,
  hostArgs: string[],
  writeSession: (dir: string) => void,
  input: HookTestInput,
): HookTestResult {
  const timeoutMs = input.timeoutMs ?? DEFAULT_HOOK_TEST_TIMEOUT_MS;
  const taskcraftDir = join(input.projectDir, ".taskcraft");
  mkdirSync(taskcraftDir, { recursive: true });
  const sessionDir = mkdtempSync(join(taskcraftDir, "test-hook-"));

  try {
    writeSession(sessionDir);
    const prompt = input.prompt ?? "Reply exactly TC_FIRST.";
    const outcome = spawn(hostCommand, [...hostArgs, prompt], {
      cwd: sessionDir,
      timeoutMs,
    });
    const sample = sampleOf(outcome.stdout);

    if (outcome.timedOut) {
      return {
        ok: false,
        entryInjected: false,
        stopEnforced: false,
        testedAt: now(),
        failure: `hook test timed out after ${timeoutMs}ms`,
        sample,
      };
    }

    if (!outcome.ok) {
      const reason =
        outcome.error === undefined
          ? `host exited with code ${String(outcome.exitCode)}`
          : `host failed: ${outcome.error}`;
      const detail = outcome.stderr.trim();
      const failureMessage =
        detail.length > 0 ? `${reason}: ${detail}` : reason;

      return {
        ok: false,
        entryInjected: false,
        stopEnforced: false,
        testedAt: now(),
        failure: failureMessage,
        sample,
      };
    }

    const parsed = parseHookTestOutput(outcome.stdout);

    if (!parsed.entryInjected) {
      return {
        ok: false,
        entryInjected: false,
        stopEnforced: parsed.stopEnforced,
        testedAt: now(),
        failure: `entry hook marker ${ENTRY_MARKER} was not observed in host output`,
        sample,
      };
    }

    return {
      ok: true,
      entryInjected: true,
      stopEnforced: parsed.stopEnforced,
      testedAt: now(),
      sample,
    };
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
}

/** Writes one agent_runs row in a transaction. Missing optional fields stay
 * empty (null / "pending" / "{}"); observations never drive task status. */
export function attachObservation(
  database: TaskcraftDatabase,
  input: AttachInput,
  now: () => string,
): HostRun {
  return withTransaction(database, () => {
    const run: HostRun = {
      id: nextAgentRunId(database),
      taskId: input.taskId,
      nodeAttemptId: input.nodeAttemptId,
      host: input.host,
      hostRunId: input.hostRunId ?? null,
      hostSessionId: input.hostSessionId ?? null,
      observationStatus: input.observationStatus ?? "pending",
      lastSeenAt: input.lastSeenAt ?? now(),
      finishReason: input.finishReason ?? null,
      observationJson: JSON.stringify(input.observation ?? {}),
    };

    database
      .prepare(
        `INSERT INTO agent_runs (
           id, task_id, node_attempt_id, host, host_run_id, host_session_id,
           observation_status, last_seen_at, finish_reason, observation_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.taskId,
        run.nodeAttemptId,
        run.host,
        run.hostRunId,
        run.hostSessionId,
        run.observationStatus,
        run.lastSeenAt,
        run.finishReason,
        run.observationJson,
      );

    return run;
  });
}

function nextAgentRunId(database: TaskcraftDatabase): string {
  const row = database
    .prepare("SELECT COUNT(*) AS n FROM agent_runs")
    .get() as { n: number };

  return `ar-${row.n + 1}`;
}

/** Pure observation mapping: stamps a fresh last-seen on the run and keeps
 * the observed status; never maps to task completion. */
export function observeRun(
  run: HostRun,
  now: () => string,
): RuntimeObservation {
  const observation: RuntimeObservation = {
    status: run.observationStatus,
    lastSeenAt: run.lastSeenAt ?? now(),
  };

  if (run.finishReason !== null) {
    observation.finishReason = run.finishReason;
  }

  return observation;
}
