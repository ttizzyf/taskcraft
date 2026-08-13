// tc agent: host adapter inspection and hook field tests. capabilities()
// never crashes a command (probe failures become explicit unavailable items);
// test-hook exercises the INSTALLED .taskcraft/hooks scripts against the real
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
  persistHookTest,
} from "../adapters/installed-hooks.js";
import type { AdapterCapabilities, HostAdapter } from "../adapters/types.js";
import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { readTaskcraftConfig } from "../hooks/shared.js";
import { execute, isJsonMode, printCommandResult } from "./helpers.js";

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
      "Use: tc init --agent codex|claude, or tc agent test-hook --agent codex|claude",
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
    remediation: "Install codex or claude, then re-run: tc agent test-hook",
  });
}

/** Text renderer for the capabilities of one or more hosts; JSON mode prints
 * the same data through the command-result envelope. */
export function renderCapabilities(
  hosts: readonly AdapterCapabilities[],
): string {
  const lines = ["Host capabilities (read-only probe):"];

  for (const host of hosts) {
    lines.push(`${host.host} ${host.version ?? "<unknown version>"}`);
    lines.push(
      ...host.items.map((item) => `  ${item.name}: ${itemLabel(item)}`),
    );
  }

  return lines.join("\n");
}

function itemLabel(item: AdapterCapabilities["items"][number]): string {
  if (item.available) {
    return item.limitation === undefined
      ? "available"
      : `limited: ${item.limitation}`;
  }

  return `unavailable: ${item.limitation ?? "no local evidence"}`;
}

export interface HookTestSummary {
  host: string;
  version: string | null;
  ok: boolean;
  entryInjected: boolean;
  stopBlocked: boolean;
  loopGuardOk: boolean;
  /** enforced = entry injection + stop block + loop guard all passed; the
   * command exits non-zero unless enforced (no advisory success). */
  enforced: boolean;
  testedAt: string;
  failure?: string;
  sample?: string;
}

/** Field test against one adapter with the installed hooks: reads the
 * project config (takeover must not be off), verifies the installed scripts
 * and their registration, runs the real chain against the real Task Store
 * (60s host timeout in the shared runner) and persists the outcome into
 * config.hookTests[host]. Every failure is an explicit TC_ADAPTER_* error,
 * never an advisory success. */
export function runAgentTestHook(
  adapter: HostAdapter,
  projectDir: string,
): HookTestSummary {
  const configPath = join(projectDir, ".taskcraft", "config.json");
  const version = adapter.capabilities().version;
  const takeOver = readTakeOver(configPath, adapter.id);

  if (takeOver === "off") {
    throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED, {
      problem: "takeover is off",
      impact:
        "Hooks produce zero output while takeover is off, so injection and blocking cannot be tested",
      remediation: "Enable takeover first: tc enable ask|always",
      context: { host: adapter.id, configPath },
    });
  }

  const scripts = checkInstalledScripts(projectDir);
  checkProjectRegistration(adapter.id, projectDir);

  const result = adapter.testHook({
    projectDir,
    entryScript: scripts.entryScript,
    stopScript: scripts.stopScript,
  });
  const summary: HookTestSummary = {
    host: adapter.id,
    version,
    ok: result.ok,
    entryInjected: result.entryInjected,
    stopBlocked: result.stopBlocked,
    loopGuardOk: result.loopGuardOk,
    enforced: result.enforced,
    testedAt: result.testedAt,
    ...(result.failure === undefined ? {} : { failure: result.failure }),
    ...(result.sample === undefined ? {} : { sample: result.sample }),
  };

  persistHookTest(configPath, adapter.id, {
    testedAt: result.testedAt,
    version,
    ok: result.ok,
    enforced: result.enforced,
    ...(result.failure === undefined ? {} : { failure: result.failure }),
  });

  if (!result.ok) {
    throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED, {
      problem: `Hook field test failed: ${result.failure ?? "unknown error"}`,
      impact:
        "Entry injection, stop blocking or the loop guard could not be verified",
      remediation:
        "Fix the failing checks above, then re-run: tc agent test-hook",
      context: {
        host: adapter.id,
        testedAt: result.testedAt,
        entryInjected: result.entryInjected,
        stopBlocked: result.stopBlocked,
        loopGuardOk: result.loopGuardOk,
      },
      cause: result.failure,
    });
  }

  return summary;
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
        const hosts = localAdapters().map((adapter) => adapter.capabilities());

        if (json) {
          printCommandResult({ hosts });
          return;
        }

        console.log(renderCapabilities(hosts));
      }, json);
    });

  agent
    .command("test-hook")
    .description(
      "field-test the installed entry/stop hooks against a local host (60s timeout)",
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
        const summary = runAgentTestHook(adapter, process.cwd());

        if (json) {
          printCommandResult(summary);
          return;
        }

        console.log("Hook field test: ok");
        console.log(`host: ${summary.host}`);
        console.log(`version: ${summary.version ?? "<unknown>"}`);
        console.log(`entryInjected: ${summary.entryInjected}`);
        console.log(`stopBlocked: ${summary.stopBlocked}`);
        console.log(`loopGuardOk: ${summary.loopGuardOk}`);
        console.log(`enforced: ${summary.enforced}`);
        console.log(`testedAt: ${summary.testedAt}`);
      }, json);
    });
}
