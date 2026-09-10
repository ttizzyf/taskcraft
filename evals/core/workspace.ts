import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

export function createWorkspace(caseId: string): string {
  return mkdtempSync(join(tmpdir(), `taskcraft-eval-${caseId}-`));
}

export function writeText(
  workspace: string,
  path: string,
  content: string,
): void {
  const target = join(workspace, path);
  const parent = target.slice(0, target.lastIndexOf("/"));
  if (parent) mkdir(parent);
  writeFileSync(target, content, "utf8");
}

export function writeJson(
  workspace: string,
  path: string,
  value: unknown,
): void {
  writeText(workspace, path, `${JSON.stringify(value, null, 2)}\n`);
}

export function installTcWrapper(workspace: string, cliPath: string): void {
  const wrapper = [
    "#!/bin/sh",
    `exec ${shellQuote(process.execPath)} ${shellQuote(cliPath)} "$@"`,
    "",
  ].join("\n");
  writeText(workspace, "bin/tc", wrapper);
  chmodSync(join(workspace, "bin/tc"), 0o755);
}

export function prependPath(workspace: string): string {
  return `${join(workspace, "bin")}:${process.env.PATH ?? ""}`;
}

export function sourceSnapshot(
  workspace: string,
): Array<{ path: string; sha256: string; bytes: number }> {
  const root = resolve(workspace, "src");
  const files: Array<{ path: string; sha256: string; bytes: number }> = [];
  collectFiles(root, workspace, files);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function collectFiles(
  directory: string,
  workspace: string,
  files: Array<{ path: string; sha256: string; bytes: number }>,
): void {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collectFiles(path, workspace, files);
      continue;
    }
    const bytes = readFileSync(path);
    files.push({
      path: relative(workspace, path),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
    });
  }
}

function mkdir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
