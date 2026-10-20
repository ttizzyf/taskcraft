// The Entry Hook wrapper scripts `tc init` writes into a project. They are
// project content, not adapter internals: both derive the project root from
// their own location and resolve the CLI from the project, so a clone keeps
// working without re-running init.

/** The CLI candidates both wrappers try, in order, relative to the project
 * root. The two templates and the pre-flight check that mirrors them are all
 * generated from this one list, so a check can never validate a resolution
 * order the wrappers have stopped using. */
export const CLI_CANDIDATES = [
  "dist/cli.js",
  "node_modules/taskcraft/dist/cli.js",
] as const;

/** `join(projectRoot, "dist", "cli.js")` for one candidate. */
function joinCall(candidate: string): string {
  const segments = candidate
    .split("/")
    .map((segment) => JSON.stringify(segment))
    .join(", ");

  return `join(projectRoot, ${segments})`;
}

/** The Entry wrapper delegates to the public CLI (`tc state --breadcrumb`).
 * The project root is derived from the script location, so the wrapper never
 * depends on cwd. */
export function entryHookTemplate(): string {
  const attempts = CLI_CANDIDATES.map(
    (
      candidate,
      index,
    ) => `${index === 0 ? "if" : "elif"} [ -f "${candidate}" ]; then
  taskcraft_output="$(node "${candidate}" state --breadcrumb)"`,
  ).join("\n");

  return `#!/usr/bin/env bash
# Taskcraft managed entry hook gate (tc init --agent <host>).
cd "$(dirname "$0")/../.." || exit $?
# Resolve the CLI from the project, never from the installing machine: this
# wrapper is project content and must keep working after a clone. A PATH
# install is the fallback for projects that depend on a global tc.
${attempts}
else
  taskcraft_output="$(tc state --breadcrumb)"
fi
taskcraft_status=$?
if [ "$taskcraft_status" -ne 0 ]; then
  exit "$taskcraft_status"
fi
if [ -n "$taskcraft_output" ]; then
  # A bare JSON object is interpreted as the host's hook control protocol.
  # Prefix the business breadcrumb so both Codex and Claude inject it as text.
  printf '%s\\n' 'Taskcraft Entry context:' "$taskcraft_output"
fi
`;
}

/** The Windows Entry wrapper. Windows hosts run hook commands through
 * cmd.exe/PowerShell, which have no `bash`, so the POSIX wrapper cannot run
 * there. This Node gate does the same job without any shell: it derives the
 * project root from its own location, runs the read-only breadcrumb gate and
 * prefixes the label so the host injects text instead of hook-control JSON. */
export function entryGateTemplate(): string {
  const candidates = CLI_CANDIDATES.map(
    (candidate) => `    ${joinCall(candidate)},`,
  ).join("\n");

  return `// Taskcraft managed entry hook gate (tc init --agent <host>).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Resolves the CLI from the project, never from the installing machine: this
 * wrapper is project content and must keep working after a clone. A PATH
 * install is the fallback for projects that depend on a global tc. */
function resolveCli() {
  for (const candidate of [
${candidates}
  ]) {
    if (existsSync(candidate)) {
      return { file: process.execPath, args: [candidate, "state", "--breadcrumb"] };
    }
  }

  // A PATH install has to go through the command interpreter: npm installs a
  // global tc as a .cmd shim, and CreateProcess cannot run one directly.
  return process.platform === "win32"
    ? {
        file: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", "tc state --breadcrumb"],
      }
    : { file: "tc", args: ["state", "--breadcrumb"] };
}

const cli = resolveCli();
let output;
try {
  output = execFileSync(cli.file, cli.args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
} catch (error) {
  process.exit(typeof error.status === "number" ? error.status : 1);
}

if (output.trim().length > 0) {
  // A bare JSON object is interpreted as the host's hook control protocol.
  // Prefix the business breadcrumb so both Codex and Claude inject it as text.
  process.stdout.write("Taskcraft Entry context:\\n" + output.trimEnd() + "\\n");
}
`;
}
