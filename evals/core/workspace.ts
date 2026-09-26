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
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

const IS_WINDOWS = process.platform === "win32";

export function createWorkspace(caseId: string): string {
  return mkdtempSync(join(tmpdir(), `taskcraft-eval-${caseId}-`));
}

export function writeText(
  workspace: string,
  path: string,
  content: string,
): void {
  const target = join(workspace, path);
  mkdir(dirname(target));
  writeFileSync(target, content, "utf8");
}

export function writeJson(
  workspace: string,
  path: string,
  value: unknown,
): void {
  writeText(workspace, path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Installs the `tc` shim the actor resolves from PATH. cmd.exe and
 * PowerShell resolve `tc.cmd`; a POSIX shell (including Git Bash) resolves the
 * executable script, so both are written on Windows. */
export function installTcWrapper(workspace: string, cliPath: string): void {
  const script = [
    "#!/bin/sh",
    `exec ${shellQuote(process.execPath)} ${shellQuote(cliPath)} "$@"`,
    "",
  ].join("\n");
  writeText(workspace, "bin/tc", script);
  if (IS_WINDOWS) {
    writeText(
      workspace,
      "bin/tc.cmd",
      `@echo off\r\n"${process.execPath}" "${cliPath}" %*\r\n`,
    );
    return;
  }
  chmodSync(join(workspace, "bin/tc"), 0o755);
}

export function prependPath(workspace: string): string {
  return [join(workspace, "bin"), process.env.PATH ?? ""].join(delimiter);
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
