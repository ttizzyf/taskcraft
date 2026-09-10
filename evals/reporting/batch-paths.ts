import { existsSync, lstatSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export function batchDirectory(runDir: string, batchId: string): string {
  validateBatchId(batchId);
  const runRoot = canonicalizeExistingPath(runDir);
  const root = resolve(runRoot, "batches");
  assertBatchRoot(runDir, root);
  const candidate = resolve(root, batchId);
  rejectExistingSymlink(candidate, "batch directory");
  if (!pathWithin(root, candidate)) {
    throw new Error(`batch id escapes run directory: ${batchId}`);
  }
  return candidate;
}

export function batchFilePath(runDir: string, batchId: string): string {
  return join(batchDirectory(runDir, batchId), "batch.json");
}

export function validateBatchId(batchId: string): void {
  if (
    typeof batchId !== "string" ||
    batchId.trim() === "" ||
    batchId === "." ||
    batchId === ".." ||
    batchId.includes("/") ||
    batchId.includes("\\")
  ) {
    throw new Error(
      "batch id must be one non-empty directory name without path separators",
    );
  }
}

export function canonicalizeExistingPath(path: string): string {
  let current = resolve(path);
  const suffix: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    suffix.unshift(basename(current));
    current = parent;
  }
  return join(realpathSync(current), ...suffix);
}

export function resolveBatchPath(
  batchPath: string,
  storedPath: string,
): string {
  if (isAbsolute(storedPath)) {
    throw new Error(`batch path must be relative: ${storedPath}`);
  }
  const root = canonicalizeExistingPath(dirname(batchPath));
  const candidate = resolve(root, storedPath);
  if (!pathWithin(root, candidate)) {
    throw new Error(`batch path escapes batch directory: ${storedPath}`);
  }
  return candidate;
}

export function toBatchRelativePath(
  batchPath: string,
  targetPath: string,
): string {
  const root = canonicalizeExistingPath(dirname(batchPath));
  const target = resolve(targetPath);
  if (!pathWithin(root, target)) {
    throw new Error(`report path escapes batch directory: ${targetPath}`);
  }
  return relative(root, target).split(sep).join("/");
}

function assertBatchRoot(runDir: string, expectedRoot: string): void {
  const lexicalRoot = resolve(runDir, "batches");
  try {
    const stat = lstatSync(lexicalRoot);
    if (stat.isSymbolicLink()) {
      throw new Error("batch root must not be a symlink");
    }
    if (resolve(realpathSync(lexicalRoot)) !== expectedRoot) {
      throw new Error("batch root resolves outside run directory");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function rejectExistingSymlink(path: string, label: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`${label} must not be a symlink`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function pathWithin(root: string, target: string): boolean {
  const value = relative(resolve(root), resolve(target));
  return (
    value !== "" &&
    value !== ".." &&
    !value.startsWith(`..${sep}`) &&
    !isAbsolute(value)
  );
}
