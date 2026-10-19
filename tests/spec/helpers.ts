import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { ERROR_CODES, TaskcraftError } from "../../src/core/errors.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

export interface RegistryEntryInput {
  id: string;
  kind: "engineering" | "domain";
  path: string;
  summary: string;
  appliesTo: string[];
  status: "active" | "deprecated";
  authority?: string;
}

export function withProject(callback: (projectDir: string) => void): void {
  const project = createTemporaryDirectory();

  try {
    callback(project.path);
  } finally {
    project.cleanup();
  }
}

export function entry(
  id: string,
  path: string,
  appliesTo: string[] = ["src/**"],
): RegistryEntryInput {
  return {
    id,
    kind: "engineering",
    path,
    summary: `${id} summary`,
    appliesTo,
    status: "active",
  };
}

export function writeBody(
  projectDir: string,
  path: string,
  body: string | Buffer,
): void {
  const absolutePath = join(projectDir, path);
  mkdirSync(join(absolutePath, ".."), { recursive: true });

  if (typeof body === "string") {
    writeFileSync(absolutePath, body, "utf8");
  } else {
    writeFileSync(absolutePath, body);
  }
}

export function writeRegistry(
  projectDir: string,
  specs: readonly unknown[],
): void {
  mkdirSync(join(projectDir, ".taskcraft", "spec"), { recursive: true });
  writeFileSync(
    registryFile(projectDir),
    JSON.stringify({ schemaVersion: "tc-spec-registry/v1", specs }, null, 2),
    "utf8",
  );
}

export function registryFile(projectDir: string): string {
  return join(projectDir, ".taskcraft", "spec", "index.json");
}

export function expectTaskcraftError(
  action: () => unknown,
  code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
): TaskcraftError {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(TaskcraftError);
    expect((error as TaskcraftError).code).toBe(code);
    return error as TaskcraftError;
  }
}
