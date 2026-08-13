// Claude Code HostAdapter. Host-specific surface: probe commands, project
// settings (.claude/settings.json), test session format and -p flags. All
// shared logic lives in shared.ts; capabilities never assume what the local
// probe did not evidence.

import { renderNodeBrief } from "../core/node-brief.js";
import type { NodeBriefInput, RenderedNodeBrief } from "../core/node-brief.js";
import { attachObservation, observeRun } from "./observe.js";
import {
  defaultProbe,
  defaultSpawn,
  installEntryFiles,
  probeCapabilities,
  resolveTcPath,
  runHookTest,
} from "./shared.js";
import type {
  AdapterCapabilities,
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

export const CLAUDE_ID = "claude";

const VERSION_ARGS = ["--version"];
const DOCUMENT_ARG_SETS = [["--help"]];
// The field test must load the project-level settings (where the installed
// hooks are registered) and surface hook events so the breadcrumb injection
// is observable in the output stream (host-smoke S3/S4 flags).
const TEST_HOOK_ARGS = [
  "-p",
  "--include-hook-events",
  "--setting-sources",
  "user,project",
];

/** Research-backed notes: SessionStart ran pre-auth but UserPromptSubmit is
 * still documented-only, so session-start stays limited (host-feasibility
 * 2026-08-10). */
const CLAUDE_CAPABILITY_PROBES: readonly CapabilityProbe[] = [
  {
    name: "session-start",
    keywords: ["hook"],
    note: "limited: SessionStart ran pre-auth; UserPromptSubmit documented only",
  },
  { name: "stop", keywords: ["hook"] },
  { name: "structured-output", keywords: ["json schema", "json-schema"] },
  { name: "run-correlation", keywords: ["session id", "session-id"] },
];

export interface ClaudeHookEntry {
  hooks: Array<{ type: "command"; command: string }>;
}

export interface ClaudeSettings {
  hooks?: {
    SessionStart?: ClaudeHookEntry[];
    Stop?: ClaudeHookEntry[];
  };
}

/** Pure config merge: returns a new settings object with the hook entries
 * appended, never duplicating existing commands and never mutating input. */
export function buildClaudeProjectConfig(
  config: ClaudeSettings,
  commands: { entry: string; stop: string },
): ClaudeSettings {
  const hooks = { ...(config.hooks ?? {}) };

  hooks.SessionStart = appendHook(hooks.SessionStart, commands.entry);
  hooks.Stop = appendHook(hooks.Stop, commands.stop);

  return { ...config, hooks };
}

function appendHook(
  existing: ClaudeHookEntry[] | undefined,
  command: string,
): ClaudeHookEntry[] {
  const current = existing ?? [];

  return current.some((entry) =>
    entry.hooks.some((hook) => hook.command === command),
  )
    ? [...current]
    : [...current, { hooks: [{ type: "command", command }] }];
}

export function serializeClaudeSettings(config: ClaudeSettings): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function createClaudeAdapter(deps: AdapterDeps = {}): HostAdapter {
  const probe = deps.probe ?? defaultProbe;
  const spawn = deps.spawn ?? defaultSpawn;
  const now = deps.now ?? (() => new Date().toISOString());
  const database = deps.database;

  return {
    id: CLAUDE_ID,
    capabilities: (): AdapterCapabilities =>
      probeCapabilities(
        probe,
        CLAUDE_ID,
        VERSION_ARGS,
        DOCUMENT_ARG_SETS,
        CLAUDE_CAPABILITY_PROBES,
      ),
    installEntry: (input: InstallInput): InstallResult =>
      installEntryFiles(input, resolveTcPath(), {
        configPath: ".claude/settings.json",
        freshConfig: (commands) =>
          serializeClaudeSettings(buildClaudeProjectConfig({}, commands)),
      }),
    testHook: (input: HookTestInput): HookTestResult =>
      runHookTest(spawn, now, CLAUDE_ID, TEST_HOOK_ARGS, input),
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
