// Installed-hook verification for `tc agent test-entry-hook`: pre-flight
// checks (the platform Entry wrapper exists and references a valid CLI
// artifact; the project
// host config registers SessionStart), the Codex feature/trust gate and the
// config.entryHookTests persistence write. Every check
// is read-only except persistEntryHookTest (atomic tmp+rename on the project
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
import type { EntryHookTestRecord } from "../hooks/shared.js";
import { safeProbe } from "./shared.js";
import type { ProbeFn } from "./types.js";

export type TestAgent = "codex" | "claude";

export interface InstalledHookScripts {
  entryScript: string;
}

/** The installed Entry wrapper for this platform, falling back to the other
 * one when only that exists (hand-written fixtures, and projects installed by
 * an older tc that only wrote entry.sh). */
export function installedEntryWrapper(projectDir: string): string {
  const hooksDir = join(projectDir, ".taskcraft", "hooks");
  const candidates =
    process.platform === "win32"
      ? ["entry.mjs", "entry.sh"]
      : ["entry.sh", "entry.mjs"];

  for (const name of candidates) {
    const path = join(hooksDir, name);

    if (existsSync(path)) {
      return path;
    }
  }

  // Nothing installed: report the platform default so the failure names the
  // wrapper `tc init` would have written.
  return join(hooksDir, candidates[0] ?? "entry.sh");
}

/** Verifies the installed Entry wrapper exists and references an existing gate
 * artifact under dist/hooks/ (the host silently ignores a missing script, so
 * a broken reference must fail before any host call). */
export function checkInstalledScripts(
  projectDir: string,
): InstalledHookScripts {
  const entryScript = installedEntryWrapper(projectDir);

  checkScript(entryScript);

  return { entryScript };
}

function checkScript(scriptPath: string): void {
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
      `The Entry wrapper does not reference a gate script: ${scriptPath}`,
      "Re-install the hooks: tc init --agent codex|claude",
      { script: scriptPath },
    );
  }

  if (!existsSync(gatePath)) {
    throw hookTestError(
      `The Entry wrapper references a missing gate artifact: ${gatePath}`,
      "Build the CLI first: pnpm build, then re-run: tc agent test-entry-hook",
      { script: scriptPath, gate: gatePath },
    );
  }
}

/** Extracts the CLI target from a managed hook wrapper: the bash wrapper
 * quotes it after `node`, the Node gate quotes it as an execFileSync argument.
 * Both embed forward slashes, so the literal needs no unescaping. */
function referencedGatePath(scriptPath: string): string | null {
  let content: string;

  try {
    content = readFileSync(scriptPath, "utf8");
  } catch {
    return null;
  }

  const match = /"([^"\n]+\.m?js)"/.exec(content);

  return match === null ? null : (match[1] ?? null);
}

/** Verifies the project-level host config registers the installed Entry
 * wrappers; an unregistered project fails explicitly (the host would silently
 * skip the hooks, so a test without registration proves nothing). */
export function checkProjectRegistration(
  agent: TestAgent,
  projectDir: string,
): void {
  if (agent === "codex") {
    const configFile = join(projectDir, ".codex", "hooks.json");

    if (!existsSync(configFile)) {
      throw hookTestError(
        `Hooks are not registered: missing ${configFile}`,
        "Register the hooks: tc init --agent codex (or merge the registrations manually)",
        { configFile },
      );
    }

    const config = readJson(configFile, "codex project hooks");

    if (!commandsContain(hookEntries(config, "SessionStart"), projectDir)) {
      throw hookTestError(
        `Entry Hook is not registered in ${configFile}: missing a SessionStart entry pointing at the managed Entry wrapper (.taskcraft/hooks/entry.sh or entry.mjs)`,
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

  if (!commandsContain(hookEntries(settings, "SessionStart"), projectDir)) {
    throw hookTestError(
      `Entry Hook is not registered in ${settingsFile}: missing a SessionStart entry pointing at the managed Entry wrapper (.taskcraft/hooks/entry.sh or entry.mjs)`,
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

function commandsContain(entries: unknown, projectDir: string): boolean {
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

      return (
        typeof command === "string" &&
        referencesManagedEntry(command, projectDir)
      );
    });
  });
}

/** True when a registered hook command points at either managed wrapper, with
 * either path separator (a Windows config may hold `\` or `/`). */
function referencesManagedEntry(text: string, projectDir: string): boolean {
  const normalized = text.replaceAll("\\", "/");
  const hooksDir = toPosix(join(projectDir, ".taskcraft", "hooks"));

  return ["entry.sh", "entry.mjs"].some((name) => {
    if (normalized.includes(`${hooksDir}/${name}`)) {
      return true;
    }

    const escaped = name.replace(".", "\\.");
    return new RegExp(
      `(?:^|[\\s"'=])(?:\\./)?\\.taskcraft/hooks/${escaped}(?=$|[\\s"',}\\]])`,
      "m",
    ).test(normalized);
  });
}

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
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
  const hooksLine = features.stdout
    .split("\n")
    .find((line) => /^hooks\s/i.test(line.trim()));
  const hooksEnabled =
    hooksLine?.trim().split(/\s+/).at(-1)?.toLowerCase() === "true";

  if (!features.ok || !hooksEnabled) {
    const detail = features.ok
      ? hooksLine === undefined
        ? "the features list does not mention hooks"
        : `the hooks feature is not enabled (${hooksLine.trim()})`
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

/** A `[projects.<key>]` table header. TOML allows two string forms and codex
 * uses both: a basic string (`"C:\\Users\\me"`, where `\\` is one backslash)
 * and a literal string (`'C:\Users\me'`, taken verbatim — codex writes this
 * form for Windows paths so the backslashes need no escaping). */
const PROJECTS_TABLE = /^\[projects\.(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\]\s*$/;

/** A `trust_level = "trusted"` entry, in either TOML string form, ignoring
 * commented-out lines. */
const TRUSTED_LEVEL = /^\s*trust_level\s*=\s*["']trusted["']\s*(?:#.*)?$/;

/** True when the exact [projects.<path>] section for projectDir declares
 * trust_level = "trusted" in the Codex user config. Parent-directory trust
 * does not activate a nested Git project's local hooks. */
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
    const match = PROJECTS_TABLE.exec(line);

    if (match !== null) {
      const basic = match[1];
      current = {
        path: basic === undefined ? (match[2] ?? "") : unescapeToml(basic),
        lines: [],
      };
      sections.push(current);
    } else if (current !== null) {
      current.lines.push(line);
    }
  }

  return sections.some(
    (section) =>
      sameProjectPath(section.path, projectDir) &&
      section.lines.some((line) => TRUSTED_LEVEL.test(line)),
  );
}

/** Collapses the escapes a TOML basic string needs for a path, so the
 * captured text compares as the path it denotes (`"C:\\me"` means `C:\me`).
 * Only `\\` and `\"` are folded: a Windows path never contains the other
 * escapes, and folding them would corrupt a literal backslash that a
 * hand-written (strictly invalid) `"C:\local\temp"` still carries — `\t`
 * would silently become a tab. */
function unescapeToml(value: string): string {
  return value.replace(/\\(["\\])/g, "$1");
}

/** Compares paths by meaning, not by spelling: codex may record either
 * separator and its own casing, so normalize separators, drop a trailing
 * slash and — where the filesystem is case-insensitive — the case. */
function sameProjectPath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const slashed = value.replaceAll("\\", "/").replace(/\/+$/, "");
    return process.platform === "win32" ? slashed.toLowerCase() : slashed;
  };

  return normalize(left) === normalize(right);
}

/** Writes the Entry Hook test record into .taskcraft/config.json with an atomic
 * tmp+rename; every other config field survives untouched. */
export function persistEntryHookTest(
  configPath: string,
  agent: string,
  record: EntryHookTestRecord,
): void {
  try {
    const existing = readTaskcraftConfig(configPath);
    const entryHookTests = {
      ...(existing.entryHookTests as Record<string, unknown> | undefined),
    };

    entryHookTests[agent] = record;
    atomicWriteJson(configPath, { ...existing, entryHookTests });
  } catch (cause) {
    throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED, {
      problem: `Could not persist the Entry Hook test result: ${describeCause(cause)}`,
      impact: "The Entry Hook test ran but its result was not recorded",
      remediation:
        "Check the .taskcraft/ directory permissions, then re-run: tc agent test-entry-hook",
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
      "Move the invalid host config aside, then re-run: tc init --agent codex|claude",
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
    impact: "The installed Entry Hook chain is not ready for a field test",
    remediation,
    context,
    ...(cause === undefined ? {} : { cause }),
  });
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
