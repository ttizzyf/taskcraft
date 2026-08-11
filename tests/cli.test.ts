import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

function runCli(argument: string) {
  return spawnSync(process.execPath, ["dist/cli.js", argument], {
    encoding: "utf8",
  });
}

describe("tc CLI shell", () => {
  it("prints root help with the L1 business commands", () => {
    const result = runCli("--help");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: tc [options]");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("task");
    expect(result.stdout).toContain("run");
    expect(result.stdout).toContain("status");
  });

  it("reads the version from package.json", () => {
    const result = runCli("--version");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(packageJson.version);
  });
});
