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
  it("prints root help without business commands", () => {
    const result = runCli("--help");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: tc [options]");
    expect(result.stdout).not.toContain("Commands:");
  });

  it("reads the version from package.json", () => {
    const result = runCli("--version");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(packageJson.version);
  });
});
