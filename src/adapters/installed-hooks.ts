// Installed-hook verification for `tc agent test-hook`: pre-flight checks
// (hook scripts exist and reference valid dist/hooks gate artifacts; the
// project-level host config actually registers both hooks), the codex
// feature/trust gate and the config.hookTests persistence write. Every check
// is read-only except persistHookTest (atomic tmp+rename on the project
// config). Failures are explicit TC_ADAPTER_HOOK_TEST_FAILED errors: the
// command never substitutes an advisory success for a failed check.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { readTaskcraftConfig } from "../hooks/shared.js";
import type { HookTestRecord } from "../hooks/shared.js";
import { safeProbe } from "./shared.js";
import type { ProbeFn } from "./types.js";

export type TestAgent = "codex" | "claude";

export interface InstalledHookScripts {
  entryScript: string;
  stopScript: string;
}

/** Verifies both installed wrappers exist and reference an existing gate
 * artifact under dist/hooks/ (the host silently ignores a missing script, so
 * a broken reference must fail before any host call). */
export function checkInstalledScripts(
  projectDir: string,
): InstalledHookScripts {
  const hooksDir = join(projectDir, ".taskcraft", "hooks");
  const entryScript = join(hooksDir, "entry.sh");
  const stopScript = join(hooksDir, "stop.sh");

  checkScript(entryScript, "entry");
  checkScript(stopScript, "stop");

  return { entryScript, stopScript };
}

function checkScript(scriptPath: string, kind: "entry" | "stop"): void {
  if (!existsSync(scriptPath)) {
    throw hookTestError(
      `Installed hook script is missing: ${scriptPath}`,
      "Install the hooks first: tc init --agent codex|claude",
      { script: scriptPath },
    );
  }

  const gatePath = referencedGatePath(scriptPath);

  if (gatePath === null) {
    throw hookTestError(
      `${kind}.sh does not reference a gate script: ${scriptPath}`,
      "Re-install the hooks: tc init --agent codex|claude",
      { script: scriptPath },
    );
  }

  if (!existsSync(gatePath)) {
    throw hookTestError(
      `${kind}.sh references a missing gate artifact: ${gatePath}`,
      "Build the CLI first: pnpm build, then re-run: tc agent test-hook",
      { script: scriptPath, gate: gatePath },
    );
  }
}

/** Extracts the `node "<path>"` target from a managed hook wrapper. */
function referencedGatePath(scriptPath: string): string | null {
  let content: string;

  try {
    content = readFileSync(scriptPath, "utf8");
  } catch {
    return null;
  }

  const match = /node "([^"]+\.js)"/.exec(content);

  return match === null ? null : (match[1] ?? null);
}

/** Verifies the project-level host config registers the installed entry/stop
 * wrappers; an unregistered project fails explicitly (the host would silently
 * skip the hooks, so a test without registration proves nothing). */
export function checkProjectRegistration(
  agent: TestAgent,
  projectDir: string,
): void {
  if (agent === "codex") {
    const configFile = join(projectDir, ".codex", "config.toml");

    if (!existsSync(configFile)) {
      throw hookTestError(
        `Hooks are not registered: missing ${configFile}`,
        "Register the hooks: tc init --agent codex (or merge the registrations manually)",
        { configFile },
      );
    }

    const text = readText(configFile, "codex project config");

    if (
      !text.includes("hooks.SessionStart") ||
      !text.includes("entry.sh") ||
      !text.includes("hooks.Stop") ||
      !text.includes("stop.sh")
    ) {
      throw hookTestError(
        `Hooks are not registered in ${configFile}: missing SessionStart/Stop entries pointing at entry.sh/stop.sh`,
        "Register the hooks: tc init --agent codex (or merge the registrations manually)",
        { configFile },
      );
    }

    return;
  }

  const settingsFile = join(projectDir, ".claude", "settings.json");

  if (!existsSync(settingsFile)) {
    throw hookTestError(
      `Hooks are not registered: missing ${settingsFile}`,
      "Register the hooks: tc init --agent claude (or merge the registrations manually)",
      { settingsFile },
    );
  }

  const settings = readJson(settingsFile, "claude project settings");

  if (
    !commandsContain(hookEntries(settings, "SessionStart"), "entry.sh") ||
    !commandsContain(hookEntries(settings, "Stop"), "stop.sh")
  ) {
    throw hookTestError(
      `Hooks are not registered in ${settingsFile}: missing SessionStart/Stop entries pointing at entry.sh/stop.sh`,
      "Register the hooks: tc init --agent claude (or merge the registrations manually)",
      { settingsFile },
    );
  }
}

function hookEntries(
  settings: Record<string, unknown> | null,
  event: string,
): unknown {
  if (settings === null) {
    return [];
  }

  const hooks = settings.hooks;

  return typeof hooks === "object" && hooks !== null
    ? (hooks as Record<string, unknown>)[event]
    : [];
}

function commandsContain(entries: unknown, needle: string): boolean {
  if (!Array.isArray(entries)) {
    return false;
  }

  return entries.some((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return false;
    }

    const hooks = (entry as Record<string, unknown>).hooks;

    if (!Array.isArray(hooks)) {
      return false;
    }

    return hooks.some((hook) => {
      if (typeof hook !== "object" || hook === null) {
        return false;
      }

      const command = (hook as Record<string, unknown>).command;

      return typeof command === "string" && command.includes(needle);
    });
  });
}

/** Codex hooks feature/trust gate: the `codex features list` probe must
 * mention hooks and the project must be trusted in the user config (project
 * hooks are gated by trust; an unconfirmed trust must fail, never pass as
 * advisory). Returns null when satisfied, otherwise the failure reason. */
export function codexHookGate(
  probe: ProbeFn,
  projectDir: string,
  userConfigPath: string,
): string | null {
  const features = safeProbe(probe, "codex", ["features", "list"]);

  if (!features.ok || !features.stdout.toLowerCase().includes("hooks")) {
    const detail = features.ok
      ? "the features list does not mention hooks"
      : probeDetail(features);

    return `codex hooks feature gate: ${detail}; enable with: codex features enable hooks`;
  }

  if (!isProjectTrusted(userConfigPath, projectDir)) {
    return `codex project trust gate: no trust_level = "trusted" entry covering ${projectDir} in ${userConfigPath}; trust the project first (codex prompts on first use)`;
  }

  return null;
}

function probeDetail(outcome: { stderr: string; error?: string }): string {
  const stderr = outcome.stderr.trim();

  return stderr.length > 0 ? stderr : (outcome.error ?? "probe failed");
}

/** True when a [projects."<path>"] section whose path covers projectDir
 * declares trust_level = "trusted" in the codex user config. */
function isProjectTrusted(userConfigPath: string, projectDir: string): boolean {
  let text: string;

  try {
    text = readFileSync(userConfigPath, "utf8");
  } catch {
    return false;
  }

  let current: { path: string; lines: string[] } | null = null;
  const sections: Array<{ path: string; lines: string[] }> = [];

  for (const line of text.split("\n")) {
    const match = /^\[projects\."(.+)"\]\s*$/.exec(line);

    if (match !== null) {
      current = { path: match[1] ?? "", lines: [] };
      sections.push(current);
    } else if (current !== null) {
      current.lines.push(line);
    }
  }

  return sections.some((section) => {
    const base = section.path.replace(/\/$/, "");

    return (
      (projectDir === base || projectDir.startsWith(`${base}/`)) &&
      section.lines.some((line) => line.includes('trust_level = "trusted"'))
    );
  });
}

/** Writes the hook test record into .taskcraft/config.json with an atomic
 * tmp+rename; every other config field survives untouched. */
export function persistHookTest(
  configPath: string,
  agent: string,
  record: HookTestRecord,
): void {
  try {
    const existing = readTaskcraftConfig(configPath);
    const hookTests = {
      ...(existing.hookTests as Record<string, unknown> | undefined),
    };

    hookTests[agent] = record;
    atomicWriteJson(configPath, { ...existing, hookTests });
  } catch (cause) {
    throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED, {
      problem: `Could not persist the hook test result: ${describeCause(cause)}`,
      impact: "The hook test ran but its result was not recorded",
      remediation:
        "Check the .taskcraft/ directory permissions, then re-run: tc agent test-hook",
      context: { configPath, agent },
      cause,
    });
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.config.json.tmp-${process.pid}`);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function readText(path: string, what: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    throw hookTestError(
      `Cannot read the ${what}: ${path}`,
      "Register the hooks: tc init --agent codex|claude",
      { path },
      cause,
    );
  }
}

function readJson(path: string, what: string): Record<string, unknown> | null {
  const text = readText(path, what);
  let parsed: unknown;

  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    throw hookTestError(
      `The ${what} is not valid JSON: ${path}`,
      "Re-run: tc init --agent claude to regenerate the registration",
      { path },
      cause,
    );
  }

  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function hookTestError(
  problem: string,
  remediation: string,
  context: Record<string, string | number | boolean | null>,
  cause?: unknown,
): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED, {
    problem,
    impact: "The installed hook chain is not ready for a field test",
    remediation,
    context,
    ...(cause === undefined ? {} : { cause }),
  });
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
