import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function batchDirectory(runDir: string, batchId: string): string {
  validateBatchId(batchId);
  const root = resolve(runDir, "batches");
  const candidate = resolve(root, batchId);
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

export function resolveBatchPath(
  batchPath: string,
  storedPath: string,
): string {
  if (isAbsolute(storedPath)) {
    throw new Error(`batch path must be relative: ${storedPath}`);
  }
  const root = resolve(dirname(batchPath));
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
  const root = resolve(dirname(batchPath));
  const target = resolve(targetPath);
  if (!pathWithin(root, target)) {
    throw new Error(`report path escapes batch directory: ${targetPath}`);
  }
  return relative(root, target).split(sep).join("/");
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
