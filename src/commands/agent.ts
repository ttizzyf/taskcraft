// tc agent: host adapter inspection and Entry Hook field tests. capabilities()
// never crashes a command (probe failures become explicit unavailable items);
// test-entry-hook exercises the installed .taskcraft/hooks/entry.sh against the real
// Task Store and project config (never a temporary reinstall) and fails
// explicitly on missing scripts, missing registration or an unsatisfied
// codex feature/trust gate — an advisory success never replaces a failure.
// The judgment functions take an injectable adapter so tests substitute a
// fake host without spawning a real binary.

import { join } from "node:path";

import type { Command } from "commander";

import { createClaudeAdapter } from "../adapters/claude.js";
import { createCodexAdapter } from "../adapters/codex.js";
import {
  checkInstalledScripts,
  checkProjectRegistration,
  persistEntryHookTest,
} from "../adapters/installed-hooks.js";
import type { AdapterCapabilities, HostAdapter } from "../adapters/types.js";
import { BREADCRUMB_SCHEMA_VERSION } from "../core/breadcrumb.js";
import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { runEntryGate } from "../hooks/entry.js";
import {
  CONFIG_FILE_NAME,
  readEntryHookTests,
  readTaskcraftConfig,
} from "../hooks/shared.js";
import type { EntryHookTestRecord } from "../hooks/shared.js";
import {
  execute,
  isJsonMode,
  printCommandResult,
  taskcraftDirectory,
} from "./helpers.js";

export type AgentId = "codex" | "claude";

export const SUPPORTED_AGENTS: readonly AgentId[] = ["codex", "claude"];

/** Resolves an agent name to its adapter; anything else is a stable
 * TC_ADAPTER_UNSUPPORTED error (no adapter registry is ever assumed). */
export function resolveAgentAdapter(id: string): HostAdapter {
  if (id === "codex") {
    return createCodexAdapter();
  }

  if (id === "claude") {
    return createClaudeAdapter();
  }

  throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_UNSUPPORTED, {
    problem: `Unsupported agent: ${id}`,
    impact: "Hook installation and field tests only support codex and claude",
    remediation:
      "Use: tc init --agent codex|claude, or tc agent test-entry-hook --agent codex|claude",
    context: { agent: id },
  });
}

/** The two host adapters this machine can be probed for, in a stable order. */
export function localAdapters(): HostAdapter[] {
  return [createCodexAdapter(), createClaudeAdapter()];
}

/** Picks the first host whose version probe succeeded; when no supported host
 * is installed the field test cannot run and fails explicitly. */
export function pickDefaultAdapter(
  adapters: readonly HostAdapter[],
): HostAdapter {
  for (const adapter of adapters) {
    if (adapter.capabilities().version !== null) {
      return adapter;
    }
  }

  throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_UNSUPPORTED, {
    problem: "No supported host (codex or claude) was found on this machine",
    impact: "The hook field test cannot run without a local host binary",
    remediation:
      "Install codex or claude, then re-run: tc agent test-entry-hook",
  });
}

/** Capabilities plus the persisted Entry Hook test record of the same host. */
export type CapabilitiesData = AdapterCapabilities & {
  entryHookTest?: EntryHookTestRecord;
};

/** Text renderer for the capabilities of one or more hosts; each host also
 * shows its most recent persisted hook test row. JSON mode prints the same
 * data through the command-result envelope. */
export function renderCapabilities(hosts: readonly CapabilitiesData[]): string {
  const lines = ["Host capabilities (read-only probe):"];

  for (const host of hosts) {
    lines.push(`${host.host} ${host.version ?? "<unknown version>"}`);
    lines.push(
      ...host.items.map((item) => `  ${item.name}: ${itemLabel(item)}`),
    );
    lines.push(`  entry hook test: ${renderEntryHookTestLine(host)}`);
  }

  return lines.join("\n");
}

function renderEntryHookTestLine(host: CapabilitiesData): string {
  const record = host.entryHookTest;

  if (record === undefined) {
    return `never recorded (run: tc agent test-entry-hook --agent ${host.host})`;
  }

  const parts = [`tested ${record.testedAt}`];

  if (record.version !== null) {
    parts.push(`version ${record.version}`);
  }

  if (record.ok) {
    parts.push("ok");
  } else {
    parts.push(
      `failed${record.failure === undefined ? "" : `: ${record.failure}`}`,
    );
  }

  return parts.join(", ");
}

function itemLabel(item: AdapterCapabilities["items"][number]): string {
  if (item.available) {
    return item.limitation === undefined
      ? "available"
      : `limited: ${item.limitation}`;
  }

  return `unavailable: ${item.limitation ?? "no local evidence"}`;
}

export interface EntryHookTestSummary {
  host: string;
  version: string | null;
  ok: boolean;
  entryInjected: boolean;
  testedAt: string;
  failure?: string;
  sample?: string;
}

/** Field test against one adapter with the installed hooks: reads the
 * project config (takeover must not be off), verifies the installed scripts
 * and their registration, runs the real chain against the real Task Store
 * (60s host timeout in the shared runner) and persists the outcome into
 * config.entryHookTests[host]. Every failure is an explicit TC_ADAPTER_* error,
 * never an advisory success. */
export function runAgentTestEntryHook(
  adapter: HostAdapter,
  projectDir: string,
): EntryHookTestSummary {
  const configPath = join(projectDir, ".taskcraft", "config.json");
  const version = adapter.capabilities().version;
  const takeOver = readTakeOver(configPath, adapter.id);

  try {
    if (takeOver === "off") {
      throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED, {
        problem: "takeover is off",
        impact:
          "The Entry Hook produces zero output while takeover is off, so injection cannot be tested",
        remediation: "Enable takeover first: tc enable ask|always",
        context: { host: adapter.id, configPath },
      });
    }

    const scripts = checkInstalledScripts(projectDir);
    checkProjectRegistration(adapter.id, projectDir);
    assertActiveBreadcrumb(configPath, adapter.id);

    return runPersistedEntryHookTest(
      adapter,
      projectDir,
      configPath,
      version,
      scripts,
    );
  } catch (cause) {
    if (cause instanceof PersistedHookTestError) {
      throw cause.cause;
    }

    persistEntryHookTest(configPath, adapter.id, {
      testedAt: new Date().toISOString(),
      version,
      ok: false,
      failure: describeCause(cause),
    });
    throw cause;
  }
}

function runPersistedEntryHookTest(
  adapter: HostAdapter,
  projectDir: string,
  configPath: string,
  version: string | null,
  scripts: { entryScript: string },
): EntryHookTestSummary {
  const result = adapter.testEntryHook({
    projectDir,
    entryScript: scripts.entryScript,
  });
  const summary: EntryHookTestSummary = {
    host: adapter.id,
    version,
    ok: result.ok,
    entryInjected: result.entryInjected,
    testedAt: result.testedAt,
    ...(result.failure === undefined ? {} : { failure: result.failure }),
    ...(result.sample === undefined ? {} : { sample: result.sample }),
  };

  persistEntryHookTest(configPath, adapter.id, {
    testedAt: result.testedAt,
    version,
    ok: result.ok,
    ...(result.failure === undefined ? {} : { failure: result.failure }),
  });

  if (!result.ok) {
    const error = new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED, {
      problem: `Entry Hook field test failed: ${result.failure ?? "unknown error"}`,
      impact: "Entry injection could not be verified",
      remediation:
        "Fix the failing checks above, then re-run: tc agent test-entry-hook",
      context: {
        host: adapter.id,
        testedAt: result.testedAt,
        entryInjected: result.entryInjected,
      },
      cause: result.failure,
    });

    throw new PersistedHookTestError(error);
  }

  return summary;
}

/** The installed Entry chain can only prove injection when exactly one task
 * is active. Checking the production gate before the paid host call gives a
 * stable precondition error instead of a misleading "breadcrumb missing". */
function assertActiveBreadcrumb(configPath: string, host: string): void {
  const output = runEntryGate(configPath).output;

  if (output?.includes(BREADCRUMB_SCHEMA_VERSION) === true) {
    return;
  }

  throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED, {
    problem: "Hook field test requires exactly one active Taskcraft task",
    impact:
      "Entry correctly stays silent without a unique active task, so injection cannot be verified",
    remediation:
      "Create and activate a disposable task first: tc task new --title <title> --level 1 --reason <reason>, then tc run <task-id>",
    context: { host, configPath },
  });
}

/** Marker used only to avoid persisting the same adapter-result failure twice. */
class PersistedHookTestError extends Error {
  constructor(readonly cause: TaskcraftError) {
    super(cause.message);
  }
}

function readTakeOver(
  configPath: string,
  host: string,
): "off" | "ask" | "always" {
  try {
    return readTaskcraftConfig(configPath).takeOver ?? "off";
  } catch (cause) {
    throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED, {
      problem: `Cannot read the taskcraft config: ${describeCause(cause)}`,
      impact: "The takeover mode could not be checked",
      remediation:
        "Initialize and enable takeover first: tc init --agent codex|claude, then tc enable ask|always",
      context: { host, configPath },
      cause,
    });
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function register(program: Command): void {
  const agent = program.command("agent").description("host adapter commands");

  agent
    .command("capabilities")
    .description("probe local host capabilities (read-only)")
    .action(async (_options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const entryHookTests = readEntryHookTests(
          join(taskcraftDirectory(), CONFIG_FILE_NAME),
        );
        const hosts: CapabilitiesData[] = localAdapters().map((adapter) => {
          const capabilities = adapter.capabilities();
          const record = entryHookTests[capabilities.host];

          return record === undefined
            ? capabilities
            : { ...capabilities, entryHookTest: record };
        });

        if (json) {
          printCommandResult({ hosts });
          return;
        }

        console.log(renderCapabilities(hosts));
      }, json);
    });

  agent
    .command("test-entry-hook")
    .description(
      "field-test the installed Entry Hook against a local host (60s timeout)",
    )
    .option(
      "--agent <id>",
      "codex or claude (defaults to the first local host found)",
    )
    .action(async (options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const adapter =
          options.agent === undefined
            ? pickDefaultAdapter(localAdapters())
            : resolveAgentAdapter(options.agent);
        const summary = runAgentTestEntryHook(adapter, process.cwd());

        if (json) {
          printCommandResult(summary);
          return;
        }

        console.log("Entry Hook field test: ok");
        console.log(`host: ${summary.host}`);
        console.log(`version: ${summary.version ?? "<unknown>"}`);
        console.log(`entryInjected: ${summary.entryInjected}`);
        console.log(`testedAt: ${summary.testedAt}`);
      }, json);
    });
}
