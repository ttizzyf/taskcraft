// Taskcraft managed entry hook gate (tc init --agent <host>).
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
    join(projectRoot, "dist", "cli.js"),
    join(projectRoot, "node_modules", "taskcraft", "dist", "cli.js"),
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
  process.stdout.write("Taskcraft Entry context:\n" + output.trimEnd() + "\n");
}
