// Installed-hook verification for `tc agent test-entry-hook`: pre-flight
// checks (the platform Entry wrapper exists and the CLI it resolves is there;
// the project host config registers SessionStart), the Codex feature/trust gate
// and the config.entryHookTests persistence write. Every check
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
import { delimiter, dirname, isAbsolute, join } from "node:path";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { readTaskcraftConfig } from "../hooks/shared.js";
import type { EntryHookTestRecord } from "../hooks/shared.js";
import { CLI_CANDIDATES } from "./entry-scripts.js";
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

/** Verifies the installed Entry wrapper exists and that the gate it will run is
 * actually there (the host silently ignores a broken hook, so this must fail
 * before any host call). */
export function checkInstalledScripts(
  projectDir: string,
  deps: HookScriptDeps = {},
): InstalledHookScripts {
  const entryScript = installedEntryWrapper(projectDir);

  checkScript(entryScript, projectDir, deps);

  return { entryScript };
}

export interface HookScriptDeps {
  /** Resolves the managed wrappers' PATH fallback; injectable so the check
   * never depends on what the machine running it happens to have installed. */
  findOnPath?: (command: string) => string | null;
}

/** Marker both managed wrappers carry. A wrapper with it resolves the CLI the
 * managed way, which is what the check below mirrors. */
const MANAGED_WRAPPER_MARKER = "Taskcraft managed entry hook gate";

/** The global install the managed wrappers fall back to when the project has no
 * local CLI. */
const TASK_CLI_COMMAND = "tc";

/** Remediation for a host config that exists but does not register the Entry
 * Hook: `tc init` is write-if-absent and never rewrites an existing config, so
 * pointing the user at it would send them to a command that cannot succeed. */
const MERGE_BY_HAND =
  "Merge the SessionStart entry into the host config by hand: tc init never rewrites an existing config";

/** The CLI candidates the managed wrappers resolve from the project root, in
 * the order they try them — derived from the same list the wrappers are
 * generated from, so this check can never validate a stale resolution order. */
function managedCliCandidates(projectDir: string): string[] {
  return CLI_CANDIDATES.map((candidate) =>
    join(projectDir, ...candidate.split("/")),
  );
}

/** Fails unless the wrapper will reach a gate: an absolute target it names must
 * exist, and a managed wrapper must additionally resolve a CLI the way it will
 * at run time. */
function checkScript(
  scriptPath: string,
  projectDir: string,
  deps: HookScriptDeps,
): void {
  if (!existsSync(scriptPath)) {
    throw hookTestError(
      `Installed hook script is missing: ${scriptPath}`,
      "Install the hooks first: tc init --agent codex|claude",
      { script: scriptPath },
    );
  }

  const content = readTextOrNull(scriptPath) ?? "";
  const targets = referencedGateTargets(content, projectDir);

  // A target the wrapper spelled absolutely is a concrete claim about this
  // machine — it execs exactly that path — so a missing one fails here. A
  // project-relative one is a candidate the managed wrappers fall back from.
  const concrete = targets.filter((target) => target.absolute);

  if (
    concrete.length > 0 &&
    !concrete.some((target) => existsSync(target.path))
  ) {
    throw missingGateArtifact(concrete[0]!.path, scriptPath);
  }

  if (!content.includes(MANAGED_WRAPPER_MARKER)) {
    // A hand-written wrapper's own references are its whole contract.
    if (targets.length === 0) {
      throw hookTestError(
        `The Entry wrapper does not reference a gate script: ${scriptPath}`,
        MERGE_BY_HAND,
        { script: scriptPath },
      );
    }

    if (!targets.some((target) => existsSync(target.path))) {
      throw missingGateArtifact(targets[0]!.path, scriptPath);
    }

    return;
  }

  // A managed wrapper names project-relative candidates and falls back to a
  // PATH install, so the gate exists only when one of those resolves.
  const candidates = managedCliCandidates(projectDir);

  if (candidates.some((candidate) => existsSync(candidate))) {
    return;
  }

  if (findOnPath(deps)(TASK_CLI_COMMAND) !== null) {
    return;
  }

  throw hookTestError(
    `The Entry wrapper resolves no gate artifact: no Taskcraft CLI at ${candidates.join(" or ")}, and none on PATH`,
    "Install Taskcraft in the project (a dependency or a local build), or put tc on PATH, then re-run: tc agent test-entry-hook",
    { script: scriptPath, candidates: candidates.join(", ") },
  );
}

/** One CLI target a wrapper names: where it points, and whether the wrapper
 * spelled it absolutely (a concrete claim about this machine) or relative (a
 * candidate the wrapper resolves against the project root at run time). */
interface GateTarget {
  path: string;
  absolute: boolean;
}

/** Extracts the CLI targets a wrapper names, resolved the way the wrapper
 * resolves them: an absolute path as-is, a relative one against the project
 * root — the managed wrappers pass project-relative candidates to their CLI
 * resolver, so a literal such as `"cli.js"` is never a cwd-relative path. */
function referencedGateTargets(
  content: string,
  projectDir: string,
): GateTarget[] {
  const targets: GateTarget[] = [];

  for (const match of content.matchAll(/"([^"\n]+\.m?js)"/g)) {
    const literal = match[1];

    if (literal === undefined) continue;

    const absolute = isAbsolute(literal);

    targets.push({
      path: absolute ? literal : join(projectDir, literal),
      absolute,
    });
  }

  return targets;
}

/** Resolves a command on PATH without spawning anything: whether a global `tc`
 * is installed is a filesystem fact. */
function defaultFindOnPath(command: string): string | null {
  const extensions = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];

  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) continue;

    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);

      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

function findOnPath(deps: HookScriptDeps): (command: string) => string | null {
  return deps.findOnPath ?? defaultFindOnPath;
}

function missingGateArtifact(
  gatePath: string,
  scriptPath: string,
): TaskcraftError {
  return hookTestError(
    `The Entry wrapper references a missing gate artifact: ${gatePath}`,
    "Build the CLI first: pnpm build, then re-run: tc agent test-entry-hook",
    { script: scriptPath, gate: gatePath },
  );
}

function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
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
        MERGE_BY_HAND,
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
      MERGE_BY_HAND,
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

      // Codex carries its Windows form in a separate field, so both fields
      // count as the registration: the host picks one at run time.
      return ["command", "commandWindows"].some((field) => {
        const command = (hook as Record<string, unknown>)[field];

        return (
          typeof command === "string" &&
          referencesManagedEntry(command, projectDir)
        );
      });
    });
  });
}

/** Project-root anchors a host supplies to the hook command. A registration
 * that starts from one of these is project-relative and portable; a bare
 * `/wrong/.taskcraft/...` is still rejected. Both anchors are command
 * substitution in the shells the hosts actually use, so a registration carrying
 * a shell-specific rewrite (a cmd `for /f`) is not a valid anchor. */
const ROOT_ANCHORS = [
  "\\$\\{CLAUDE_PROJECT_DIR\\}",
  "\\$\\(git rev-parse --show-toplevel\\)",
];

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
    const suffix = `/\\.taskcraft/hooks/${escaped}(?=$|[\\s"',}\\]])`;

    return (
      ROOT_ANCHORS.some((anchor) =>
        new RegExp(`(?:^|[\\s"'=])${anchor}${suffix}`, "m").test(normalized),
      ) ||
      new RegExp(
        `(?:^|[\\s"'=])(?:\\./)?\\.taskcraft/hooks/${escaped}(?=$|[\\s"',}\\]])`,
        "m",
      ).test(normalized)
    );
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
      "Make the host config readable, then merge the SessionStart entry into it by hand: tc init never rewrites an existing config",
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
