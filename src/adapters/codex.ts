// Codex HostAdapter. Host-specific surface: probe commands, project config
// (.codex/config.toml), test session format and exec flags. All shared logic
// lives in shared.ts; capabilities never assume what the local probe did not
// evidence.

import { homedir } from "node:os";
import { join } from "node:path";

import { renderNodeBrief } from "../core/node-brief.js";
import type { NodeBriefInput, RenderedNodeBrief } from "../core/node-brief.js";
import { codexHookGate } from "./installed-hooks.js";
import { observeRun } from "./observe.js";
import {
  appendCommand,
  defaultProbe,
  defaultSpawn,
  installEntryFiles,
  probeCapabilities,
  resolveTcPath,
  runHookTest,
} from "./shared.js";
import type {
  AdapterDeps,
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
  "--ephemeral",
  "--skip-git-repo-check",
  "--sandbox",
  "read-only",
  "--json",
];
const TEST_HOOK_PROMPT =
  "If your injected context contains tc-breadcrumb/v1, reply exactly tc-breadcrumb/v1. Otherwise reply exactly NO_BREADCRUMB.";

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
  const userConfigPath =
    deps.userConfigPath ?? join(homedir(), ".codex", "config.toml");

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
        stopProtocol: "codex",
        freshConfig: (commands) =>
          serializeCodexProjectConfig(buildCodexProjectConfig({}, commands)),
      }),
    testHook: (input: HookTestInput): HookTestResult =>
      runHookTest(spawn, now, CODEX_ID, TEST_HOOK_ARGS, {
        ...input,
        prompt: input.prompt ?? TEST_HOOK_PROMPT,
        gate: () => codexHookGate(probe, input.projectDir, userConfigPath),
      }),
    renderNodeBrief: (input: NodeBriefInput): RenderedNodeBrief =>
      renderNodeBrief(input),
    observe: (run: HostRun): RuntimeObservation => observeRun(run, now),
  };
}
