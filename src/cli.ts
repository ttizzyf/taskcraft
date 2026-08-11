#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { Command } from "commander";

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as unknown;

  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("version" in packageJson) ||
    typeof packageJson.version !== "string"
  ) {
    throw new TypeError("package.json must contain a string version");
  }

  return packageJson.version;
}

const program = new Command()
  .name("tc")
  .description("Taskcraft command line interface")
  .version(readPackageVersion());

await program.parseAsync();
