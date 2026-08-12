// tc agent: host adapter inspection and hook field tests. capabilities()
// never crashes a command (probe failures become explicit unavailable items);
// test-hook installs into a temporary directory only, so project and global
// host config are never touched. The judgment functions take an injectable
// adapter so tests substitute a fake host without spawning a real binary.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Command } from "commander";

import { createClaudeAdapter } from "../adapters/claude.js";
import { createCodexAdapter } from "../adapters/codex.js";
import type { AdapterCapabilities, HostAdapter } from "../adapters/types.js";
import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
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
  ok: boolean;
  entryInjected: boolean;
  stopEnforced: boolean;
  /** enforced = stop hook blocked; advisory = entry injected but the stop
   * hook did not enforce (host protocol limits or no work left). */
  mode: "enforced" | "advisory";
  testedAt: string;
  failure?: string;
  sample?: string;
}

/** Field test against one adapter: installs entry hooks into a temporary
 * directory and spawns the host with the minimal prompt (60s hard timeout in
 * the shared runner). Failures become TC_ADAPTER_* diagnostics, never a fake
 * success. */
export function runAgentTestHook(adapter: HostAdapter): HookTestSummary {
  const directory = mkdtempSync(join(tmpdir(), "taskcraft-test-hook-"));

  try {
    const install = adapter.installEntry({
      projectDir: directory,
      takeOver: "ask",
    });

    if (!install.ok) {
      throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED, {
        problem: `Could not install entry hooks: ${install.limitation ?? "unknown error"}`,
        impact: "The hook field test cannot start",
        remediation:
          "Check the temporary directory permissions, then re-run: tc agent test-hook",
        context: { host: adapter.id },
      });
    }

    const result = adapter.testHook({ projectDir: directory });

    if (!result.ok) {
      throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED, {
        problem: `Hook field test failed: ${result.failure ?? "unknown error"}`,
        impact: "Entry injection or stop enforcement could not be verified",
        remediation:
          "Check the host installation and login, then re-run: tc agent test-hook",
        context: { host: adapter.id, testedAt: result.testedAt },
        cause: result.failure,
      });
    }

    return {
      host: adapter.id,
      ok: true,
      entryInjected: result.entryInjected,
      stopEnforced: result.stopEnforced,
      mode: result.stopEnforced ? "enforced" : "advisory",
      testedAt: result.testedAt,
      ...(result.sample === undefined ? {} : { sample: result.sample }),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
      "field-test entry and stop hooks against a local host (60s timeout)",
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
        const summary = runAgentTestHook(adapter);

        if (json) {
          printCommandResult(summary);
          return;
        }

        console.log("Hook field test: ok");
        console.log(`host: ${summary.host}`);
        console.log(`mode: ${summary.mode}`);
        console.log(`entryInjected: ${summary.entryInjected}`);
        console.log(`stopEnforced: ${summary.stopEnforced}`);
        console.log(`testedAt: ${summary.testedAt}`);
      }, json);
    });
}
