// Read-only Hook diagnostics. The installed wrapper/registration state and
// persisted field-test records are compared with a bounded host --version
// probe; this module never starts an agent run or writes configuration.

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import {
  checkInstalledScripts,
  checkProjectRegistration,
  installedEntryWrapper,
} from "../adapters/installed-hooks.js";
import { safeProbe } from "../adapters/shared.js";
import type { ProbeFn } from "../adapters/types.js";
import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { readEntryHookTests, readTaskcraftConfig } from "../hooks/shared.js";
import type { EntryHookTestRecord } from "../hooks/shared.js";
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

  const entryHookTests = readEntryHookTests(configFile);
  const entryWrapper = installedEntryWrapper(projectDir);
  const wrappersInstalled = existsSync(entryWrapper);
  const agents = configuredAgents(projectDir, configFile, entryHookTests);

  inspectWrappers(projectDir, wrappersInstalled, agents, items);

  for (const agent of agents) {
    inspectAgentRegistration(agent, projectDir, items);
    inspectEntryHookTest(
      agent,
      entryHookTests[agent],
      entryWrapper,
      items,
      probe,
    );
  }

  if (
    Object.keys(entryHookTests).length === 0 &&
    wrappersInstalled &&
    agents.length === 0
  ) {
    items.push({
      code: WATCH_DIAGNOSTIC_CODES.TC_ENTRY_HOOK_TEST_MISSING,
      problem: "The installed Entry Hook was never field-tested",
      impact: "Entry Hook behavior is unverified",
      remediation:
        "Verify it with: tc agent test-entry-hook --agent codex|claude",
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
        "The Entry Hook wrapper is installed but neither Codex nor Claude registers it",
      impact: "No supported host will invoke the installed Entry Hook",
      remediation:
        "Register a host with: tc init --agent codex|claude, then re-run its Entry Hook test",
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
      WATCH_DIAGNOSTIC_CODES.TC_ENTRY_HOOK_REGISTRATION_INVALID,
    );
  }
}

function inspectEntryHookTest(
  agent: "codex" | "claude",
  record: EntryHookTestRecord | undefined,
  entryWrapper: string,
  items: DiagnosticItem[],
  probe: ProbeFn,
): void {
  if (record === undefined) {
    items.push({
      code: WATCH_DIAGNOSTIC_CODES.TC_ENTRY_HOOK_TEST_MISSING,
      problem: `The installed Entry Hook for ${agent} was never field-tested`,
      impact: "Entry Hook behavior is unverified",
      remediation: `Verify it with: tc agent test-entry-hook --agent ${agent}`,
      source: "adapter",
    });
    return;
  }

  if (!record.ok) {
    items.push({
      code: ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED,
      problem: `Entry Hook field test failed for ${agent}: ${record.failure ?? "unknown failure"}`,
      impact: "Entry injection could not be verified",
      remediation: `Fix the failing check, then re-run: tc agent test-entry-hook --agent ${agent}`,
      source: "adapter",
    });
    return;
  }

  if (!existsSync(entryWrapper)) {
    items.push({
      code: ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED,
      problem: `Installed Entry Hook wrapper is missing for ${agent}: ${entryWrapper}`,
      impact: "The host silently skips the missing wrapper",
      remediation: `Re-install the hooks: tc init --agent ${agent}`,
      source: "adapter",
    });
    return;
  }

  collectVersionDrift(agent, record, entryWrapper, items, probe);
}

function collectVersionDrift(
  agent: "codex" | "claude",
  record: EntryHookTestRecord,
  entryWrapper: string,
  items: DiagnosticItem[],
  probe: ProbeFn,
): void {
  const changed = entryHookChangedAfter(entryWrapper, record.testedAt);

  if (changed !== null) {
    items.push({
      code: WATCH_DIAGNOSTIC_CODES.TC_ENTRY_HOOK_VERSION_DRIFT,
      problem: `Installed Entry Hook for ${agent} changed after the last field test (${record.testedAt}): ${changed}`,
      impact:
        "The recorded Entry Hook version no longer reflects the installed script",
      remediation: `Re-run the field test: tc agent test-entry-hook --agent ${agent}`,
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
      code: WATCH_DIAGNOSTIC_CODES.TC_ENTRY_HOOK_VERSION_DRIFT,
      problem: `Host ${agent} is now ${currentVersion}, but the last field test used ${record.version}`,
      impact:
        "The persisted hook result does not cover the currently installed host version",
      remediation: `Re-run the field test: tc agent test-entry-hook --agent ${agent}`,
      source: "adapter",
    });
  }
}

function configuredAgents(
  projectDir: string,
  configFile: string,
  entryHookTests: Record<string, EntryHookTestRecord>,
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

  if (existsSync(join(projectDir, ".codex", "hooks.json"))) {
    agents.add("codex");
  }

  if (existsSync(join(projectDir, ".claude", "settings.json"))) {
    agents.add("claude");
  }

  for (const agent of Object.keys(entryHookTests)) {
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

function entryHookChangedAfter(
  entryWrapper: string,
  testedAt: string,
): string | null {
  const tested = Date.parse(testedAt);

  if (Number.isNaN(tested)) {
    return `unparsable testedAt ${testedAt}`;
  }

  if (modifiedAfter(entryWrapper, tested)) {
    return `${basename(entryWrapper)} was modified after the test`;
  }

  for (const gate of referencedGatePaths([entryWrapper])) {
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

    for (const match of text.matchAll(/"([^"\n]+\.m?js)"/g)) {
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
