import { describe, expect, it } from "vitest";

import { spawnCommand } from "../core/process.ts";

const SEPARATOR = String.fromCharCode(31);

/** Spawns node through the same helper the hosts use and returns the argv the
 * child actually received, so argument fidelity is observed rather than
 * assumed. Runs unchanged on POSIX and Windows. */
function receivedArgv(args: readonly string[]): Promise<string[]> {
  const script = `console.log(process.argv.slice(1).join(${JSON.stringify(SEPARATOR)}))`;
  return new Promise((resolve, reject) => {
    // "--" ends node's own option parsing, which would otherwise reject the
    // unknown flags this test passes through for fidelity.
    const child = spawnCommand(
      process.execPath,
      ["-e", script, "--", ...args],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (stdout === null || stderr === null) {
      reject(new Error("child was spawned without piped stdio"));
      return;
    }
    let out = "";
    let err = "";
    stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`exit ${String(code)}: ${err.trim()}`));
        return;
      }
      resolve(out.trimEnd().split(SEPARATOR));
    });
  });
}

describe("spawnCommand argument fidelity", () => {
  it("keeps empty arguments, which the model grader passes as --tools", async () => {
    await expect(
      receivedArgv(["--tools", "", "--model", "sonnet"]),
    ).resolves.toEqual(["--tools", "", "--model", "sonnet"]);
  });

  it("keeps quoted JSON payloads and spaced tool patterns intact", async () => {
    const payload = '{"mcpServers":{}}';
    await expect(
      receivedArgv(["--mcp-config", payload, "Bash(tc *)"]),
    ).resolves.toEqual(["--mcp-config", payload, "Bash(tc *)"]);
  });
});
