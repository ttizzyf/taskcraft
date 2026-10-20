// Codex HostAdapter. Host-specific surface: probe commands, project hooks
// (.codex/hooks.json), test session format and exec flags. All shared logic
// lives in shared.ts; capabilities never assume what the local probe did not
// evidence.

import { homedir } from "node:os";
import { join } from "node:path";

import { renderNodeBrief } from "../core/node-brief.js";
import type { NodeBriefInput, RenderedNodeBrief } from "../core/node-brief.js";
import { codexHookGate } from "./installed-hooks.js";
import { observeRun } from "./observe.js";
import {
  appendCommandHook,
  defaultProbe,
  defaultSpawn,
  installEntryFiles,
  probeCapabilities,
  runEntryHookTest,
} from "./shared.js";
import type { CommandHookEntry, HookCommands } from "./shared.js";
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
  {
    name: "structured-output",
    keywords: ["output schema", "output-schema"],
    note: "limited: upstream /responses 502 risk (host-feasibility 2026-08-10); verify separately",
  },
  { name: "run-correlation", keywords: ["resume", "thread"] },
];

export interface CodexProjectConfig {
  description?: string;
  hooks?: {
    SessionStart?: CommandHookEntry[];
  };
}

/** Pure config merge: returns a new object with the hook registrations
 * appended, never duplicating existing commands and never mutating input. */
export function buildCodexProjectConfig(
  config: CodexProjectConfig,
  commands: HookCommands,
): CodexProjectConfig {
  const hooks = { ...(config.hooks ?? {}) };

  hooks.SessionStart = appendCommandHook(hooks.SessionStart, commands.entry);

  return {
    description:
      config.description ??
      "Taskcraft Entry Hook registration (managed by tc init --agent codex)",
    ...config,
    hooks,
  };
}

export function serializeCodexProjectConfig(
  config: CodexProjectConfig,
): string {
  return `${JSON.stringify(config, null, 2)}\n`;
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
      installEntryFiles(input, {
        host: "codex",
        configPath: ".codex/hooks.json",
        freshConfig: (commands) =>
          serializeCodexProjectConfig(buildCodexProjectConfig({}, commands)),
      }),
    testEntryHook: (input: HookTestInput): Promise<HookTestResult> =>
      runEntryHookTest(spawn, now, CODEX_ID, TEST_HOOK_ARGS, {
        ...input,
        prompt: input.prompt ?? TEST_HOOK_PROMPT,
        gate: () => codexHookGate(probe, input.projectDir, userConfigPath),
      }),
    renderNodeBrief: (input: NodeBriefInput): RenderedNodeBrief =>
      renderNodeBrief(input),
    observe: (run: HostRun): RuntimeObservation => observeRun(run, now),
  };
}
