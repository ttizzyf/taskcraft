// Codex HostAdapter. Host-specific surface: probe commands, project config
// (.codex/config.toml), test session format and exec flags. All shared logic
// lives in shared.ts; capabilities never assume what the local probe did not
// evidence.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderNodeBrief } from "../core/node-brief.js";
import type { NodeBriefInput, RenderedNodeBrief } from "../core/node-brief.js";
import {
  appendCommand,
  attachObservation,
  defaultProbe,
  defaultSpawn,
  ENTRY_MARKER,
  installEntryFiles,
  observeRun,
  probeCapabilities,
  resolveTcPath,
  runHookTest,
  STOP_BLOCK_MARKER,
} from "./shared.js";
import type {
  AdapterDeps,
  AttachInput,
  CapabilityProbe,
  HostAdapter,
  HostRun,
  HookTestInput,
  HookTestResult,
  InstallInput,
  InstallResult,
  RuntimeObservation,
} from "./types.js";

export const CODEX_ID = "codex";

const VERSION_ARGS = ["--version"];
const DOCUMENT_ARG_SETS = [
  ["features", "list"],
  ["exec", "--help"],
];
const TEST_HOOK_ARGS = [
  "exec",
  "--dangerously-bypass-hook-trust",
  "--ephemeral",
  "--skip-git-repo-check",
  "--sandbox",
  "read-only",
  "--json",
];

/** Research-backed notes: codex native structured output is limited by the
 * current upstream /responses path (host-feasibility 2026-08-10), never a
 * version-level guarantee. */
const CODEX_CAPABILITY_PROBES: readonly CapabilityProbe[] = [
  { name: "session-start", keywords: ["hooks"] },
  { name: "stop", keywords: ["hooks"] },
  {
    name: "structured-output",
    keywords: ["output schema", "output-schema"],
    note: "limited: upstream /responses 502 risk (host-feasibility 2026-08-10); verify with test-hook",
  },
  { name: "run-correlation", keywords: ["resume", "thread"] },
];

export interface CodexProjectConfig {
  hooks?: {
    SessionStart?: Array<{ command: string }>;
    Stop?: Array<{ command: string }>;
  };
}

/** Pure config merge: returns a new object with the hook registrations
 * appended, never duplicating existing commands and never mutating input. */
export function buildCodexProjectConfig(
  config: CodexProjectConfig,
  commands: { entry: string; stop: string },
): CodexProjectConfig {
  const hooks = { ...(config.hooks ?? {}) };

  hooks.SessionStart = appendCommand(hooks.SessionStart, commands.entry);
  hooks.Stop = appendCommand(hooks.Stop, commands.stop);

  return { ...config, hooks };
}

export function serializeCodexProjectConfig(
  config: CodexProjectConfig,
): string {
  const lines = [
    "# Taskcraft hook registration (managed by tc init --agent codex)",
  ];
  const entry = config.hooks?.SessionStart ?? [];
  const stop = config.hooks?.Stop ?? [];

  if (entry.length > 0) {
    lines.push(`hooks.SessionStart = [${tomlHooks(entry)}]`);
  }

  if (stop.length > 0) {
    lines.push(`hooks.Stop = [${tomlHooks(stop)}]`);
  }

  return `${lines.join("\n")}\n`;
}

function tomlHooks(hooks: readonly { command: string }[]): string {
  return hooks
    .map((hook) => `{ command = ${JSON.stringify(hook.command)} }`)
    .join(", ");
}

export function createCodexAdapter(deps: AdapterDeps = {}): HostAdapter {
  const probe = deps.probe ?? defaultProbe;
  const spawn = deps.spawn ?? defaultSpawn;
  const now = deps.now ?? (() => new Date().toISOString());
  const database = deps.database;

  return {
    id: CODEX_ID,
    capabilities: () =>
      probeCapabilities(
        probe,
        CODEX_ID,
        VERSION_ARGS,
        DOCUMENT_ARG_SETS,
        CODEX_CAPABILITY_PROBES,
      ),
    installEntry: (input: InstallInput): InstallResult =>
      installEntryFiles(input, resolveTcPath(), {
        configPath: ".codex/config.toml",
        freshConfig: (commands) =>
          serializeCodexProjectConfig(buildCodexProjectConfig({}, commands)),
      }),
    testHook: (input: HookTestInput): HookTestResult =>
      runHookTest(
        spawn,
        now,
        CODEX_ID,
        TEST_HOOK_ARGS,
        writeCodexSession,
        input,
      ),
    renderNodeBrief: (input: NodeBriefInput): RenderedNodeBrief =>
      renderNodeBrief(input),
    attachObservation: (input: AttachInput): HostRun => {
      if (database === undefined) {
        throw new Error("attachObservation requires a database");
      }

      return attachObservation(database, input, now);
    },
    observe: (run: HostRun): RuntimeObservation => observeRun(run, now),
  };
}

/** Minimal temporary session config: registers the entry and stop hooks to
 * echo the markers the field test parses. Real-host validation belongs to
 * host-smoke; this only pins the session shape. */
function writeCodexSession(dir: string): void {
  const configDir = join(dir, ".codex");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "config.toml"),
    `# Taskcraft hook test (temporary session config)\n` +
      `hooks.SessionStart = [{ command = "echo ${ENTRY_MARKER}" }]\n` +
      `hooks.Stop = [{ command = "echo ${STOP_BLOCK_MARKER}" }]\n`,
  );
}
