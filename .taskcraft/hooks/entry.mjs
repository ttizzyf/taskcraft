// Taskcraft managed entry hook gate (tc init --agent <host>).
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let output;
try {
  output = execFileSync(
    process.execPath,
    ["D:/a_project_flie/taskcraft/dist/cli.js", "state", "--breadcrumb"],
    { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
} catch (error) {
  process.exit(typeof error.status === "number" ? error.status : 1);
}

if (output.trim().length > 0) {
  // A bare JSON object is interpreted as the host's hook control protocol.
  // Prefix the business breadcrumb so both Codex and Claude inject it as text.
  process.stdout.write("Taskcraft Entry context:\n" + output.trimEnd() + "\n");
}
