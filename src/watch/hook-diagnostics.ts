// Read-only Hook diagnostics. The installed wrapper/registration state and
// persisted field-test records are compared with a bounded host --version
// probe; this module never starts an agent run or writes configuration.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  checkInstalledScripts,
  checkProjectRegistration,
} from "../adapters/installed-hooks.js";
import { safeProbe } from "../adapters/shared.js";
import type { ProbeFn } from "../adapters/types.js";
import { TASKCRAFT_DIRECTORY_NAME } from "../commands/helpers.js";
import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { readHookTests, readTaskcraftConfig } from "../hooks/shared.js";
import type { HookTestRecord } from "../hooks/shared.js";
import {
  WATCH_DIAGNOSTIC_CODES,
  type DiagnosticItem,
} from "./diagnostic-types.js";

export function collectHookDiagnostics(
  projectDir: string,
  configFile: string,
  items: DiagnosticItem[],
  probe: ProbeFn,
): void {
  if (!existsSync(configFile)) {
    return;
  }

  const hookTests = readHookTests(configFile);
  const hooksDir = join(projectDir, TASKCRAFT_DIRECTORY_NAME, "hooks");
  const wrappers = {
    entry: join(hooksDir, "entry.sh"),
    stop: join(hooksDir, "stop.sh"),
  };
  const wrappersInstalled =
    existsSync(wrappers.entry) || existsSync(wrappers.stop);
  const agents = configuredAgents(projectDir, configFile, hookTests);

  inspectWrappers(projectDir, wrappersInstalled, agents, items);

  for (const agent of agents) {
    inspectAgentRegistration(agent, projectDir, items);
    inspectHookTest(agent, hookTests[agent], wrappers, items, probe);
  }

  if (
    Object.keys(hookTests).length === 0 &&
    wrappersInstalled &&
    agents.length === 0
  ) {
    items.push({
      code: WATCH_DIAGNOSTIC_CODES.TC_HOOK_TEST_MISSING,
      problem: "Installed hooks were never field-tested",
      impact: "Entry/Stop hook behavior is unverified",
      remediation: "Verify them with: tc agent test-hook --agent codex|claude",
      source: "adapter",
    });
  }
}

function inspectWrappers(
  projectDir: string,
  wrappersInstalled: boolean,
  agents: readonly string[],
  items: DiagnosticItem[],
): void {
  if (wrappersInstalled) {
    try {
      checkInstalledScripts(projectDir);
    } catch (cause) {
      pushAdapterDiagnostic(
        items,
        cause,
        ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED,
      );
    }
  }

  if (wrappersInstalled && agents.length === 0) {
    items.push({
      code: ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED,
      problem:
        "Hook wrappers are installed but neither Codex nor Claude registers them",
      impact: "No supported host will invoke the installed hook chain",
      remediation:
        "Register a host with: tc init --agent codex|claude, then re-run its field test",
      source: "adapter",
    });
  }
}

function inspectAgentRegistration(
  agent: "codex" | "claude",
  projectDir: string,
  items: DiagnosticItem[],
): void {
  try {
    checkProjectRegistration(agent, projectDir);
  } catch (cause) {
    pushAdapterDiagnostic(
      items,
      cause,
      WATCH_DIAGNOSTIC_CODES.TC_HOOK_REGISTRATION_INVALID,
    );
  }
}

function inspectHookTest(
  agent: "codex" | "claude",
  record: HookTestRecord | undefined,
  wrappers: { entry: string; stop: string },
  items: DiagnosticItem[],
  probe: ProbeFn,
): void {
  if (record === undefined) {
    items.push({
      code: WATCH_DIAGNOSTIC_CODES.TC_HOOK_TEST_MISSING,
      problem: `Installed hooks for ${agent} were never field-tested`,
      impact: "Entry/Stop hook behavior is unverified",
      remediation: `Verify them with: tc agent test-hook --agent ${agent}`,
      source: "adapter",
    });
    return;
  }

  if (!record.ok) {
    items.push({
      code: ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED,
      problem: `Hook field test failed for ${agent}: ${record.failure ?? "unknown failure"}`,
      impact: "Entry injection or stop blocking could not be verified",
      remediation: `Fix the failing check, then re-run: tc agent test-hook --agent ${agent}`,
      source: "adapter",
    });
    return;
  }

  if (!existsSync(wrappers.entry) || !existsSync(wrappers.stop)) {
    items.push({
      code: ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED,
      problem: `Installed hook wrapper is missing for ${agent}: ${wrappers.entry} or ${wrappers.stop}`,
      impact: "The host silently skips the missing wrapper",
      remediation: `Re-install the hooks: tc init --agent ${agent}`,
      source: "adapter",
    });
    return;
  }

  collectVersionDrift(agent, record, wrappers, items, probe);
}

function collectVersionDrift(
  agent: "codex" | "claude",
  record: HookTestRecord,
  wrappers: { entry: string; stop: string },
  items: DiagnosticItem[],
  probe: ProbeFn,
): void {
  const changed = hookChainChangedAfter(wrappers, record.testedAt);

  if (changed !== null) {
    items.push({
      code: WATCH_DIAGNOSTIC_CODES.TC_HOOK_VERSION_DRIFT,
      problem: `Installed hook chain for ${agent} changed after the last field test (${record.testedAt}): ${changed}`,
      impact:
        "The recorded hook version no longer reflects the installed scripts",
      remediation: `Re-run the field test: tc agent test-hook --agent ${agent}`,
      source: "adapter",
    });
  }

  const currentVersion = probeHostVersion(probe, agent);

  if (
    record.version !== null &&
    currentVersion !== null &&
    currentVersion !== record.version
  ) {
    items.push({
      code: WATCH_DIAGNOSTIC_CODES.TC_HOOK_VERSION_DRIFT,
      problem: `Host ${agent} is now ${currentVersion}, but the last field test used ${record.version}`,
      impact:
        "The persisted hook result does not cover the currently installed host version",
      remediation: `Re-run the field test: tc agent test-hook --agent ${agent}`,
      source: "adapter",
    });
  }
}

function configuredAgents(
  projectDir: string,
  configFile: string,
  hookTests: Record<string, HookTestRecord>,
): Array<"codex" | "claude"> {
  const agents = new Set<"codex" | "claude">();

  try {
    for (const agent of readTaskcraftConfig(configFile).agents ?? []) {
      if (agent === "codex" || agent === "claude") {
        agents.add(agent);
      }
    }
  } catch {
    // The aggregate diagnostics already reports malformed configuration.
  }

  if (existsSync(join(projectDir, ".codex", "config.toml"))) {
    agents.add("codex");
  }

  if (existsSync(join(projectDir, ".claude", "settings.json"))) {
    agents.add("claude");
  }

  for (const agent of Object.keys(hookTests)) {
    if (agent === "codex" || agent === "claude") {
      agents.add(agent);
    }
  }

  return [...agents].sort();
}

function pushAdapterDiagnostic(
  items: DiagnosticItem[],
  cause: unknown,
  codeOverride?: string,
): void {
  if (cause instanceof TaskcraftError) {
    items.push({
      code: codeOverride ?? cause.code,
      problem: cause.problem,
      impact: cause.impact,
      remediation: cause.remediation,
      source: "adapter",
    });
    return;
  }

  items.push({
    code: ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED,
    problem: `Hook installation cannot be inspected: ${describe(cause)}`,
    impact: "The installed hook chain cannot be trusted",
    remediation: "Re-install the hooks with: tc init --agent codex|claude",
    source: "adapter",
  });
}

function probeHostVersion(
  probe: ProbeFn,
  agent: "codex" | "claude",
): string | null {
  const outcome = safeProbe(probe, agent, ["--version"]);
  return outcome.ok ? outcome.stdout.trim() || null : null;
}

function hookChainChangedAfter(
  wrappers: { entry: string; stop: string },
  testedAt: string,
): string | null {
  const tested = Date.parse(testedAt);

  if (Number.isNaN(tested)) {
    return `unparsable testedAt ${testedAt}`;
  }

  for (const [label, path] of [
    ["entry.sh", wrappers.entry],
    ["stop.sh", wrappers.stop],
  ] as const) {
    if (modifiedAfter(path, tested)) {
      return `${label} was modified after the test`;
    }
  }

  for (const gate of referencedGatePaths([wrappers.entry, wrappers.stop])) {
    if (modifiedAfter(gate, tested)) {
      return `${gate} was rebuilt after the test`;
    }
  }

  return null;
}

function modifiedAfter(path: string, timestamp: number): boolean {
  try {
    return statSync(path).mtimeMs > timestamp;
  } catch {
    return false;
  }
}

function referencedGatePaths(scripts: readonly string[]): string[] {
  const paths: string[] = [];

  for (const script of scripts) {
    let text: string;

    try {
      text = readFileSync(script, "utf8");
    } catch {
      continue;
    }

    for (const match of text.matchAll(/node "([^"]+\.js)"/g)) {
      const path = match[1];

      if (path !== undefined) {
        paths.push(path);
      }
    }
  }

  return paths;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
