import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative, sep, win32 } from "node:path";

import { TaskcraftError } from "../core/errors.js";
import { isFileSystemError, specPathInvalid } from "./errors.js";

export function resolveProjectDirectory(projectDir: string): string {
  const realPath = resolveExistingRealPath(projectDir, "Project directory");

  try {
    if (!statSync(realPath).isDirectory()) {
      throw specPathInvalid("The project path is not a directory");
    }
  } catch (cause) {
    if (cause instanceof TaskcraftError) {
      throw cause;
    }
    throw specPathInvalid("The project directory cannot be inspected", cause);
  }

  return realPath;
}

export function resolveExistingRealPath(path: string, label: string): string {
  try {
    return realpathSync(path);
  } catch (cause) {
    throw specPathInvalid(`${label} cannot be resolved`, cause);
  }
}

export function assertContained(
  projectRealPath: string,
  targetRealPath: string,
  label: string,
): void {
  const fromProject = relative(projectRealPath, targetRealPath);

  if (
    fromProject === ".." ||
    fromProject.startsWith(`..${sep}`) ||
    isAbsolute(fromProject)
  ) {
    throw specPathInvalid(`${label} resolves outside the project`);
  }
}

/** Opens and reads the already-resolved path through one descriptor. The
 * descriptor prevents a final-component symlink swap between validation and
 * reading; the inode comparison also rejects replacement before the read.
 * Node does not expose openat(2), so callers still must not treat this as a
 * sandbox against an adversary concurrently replacing ancestor directories. */
export function readVerifiedRegularFile(
  projectRealPath: string,
  realPath: string,
  label: string,
): Buffer {
  let descriptor: number | undefined;

  try {
    if (!lstatSync(realPath).isFile()) {
      throw specPathInvalid(`${label} is not a regular file`);
    }

    descriptor = openSync(
      realPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const opened = fstatSync(descriptor);

    if (!opened.isFile()) {
      throw specPathInvalid(`${label} is not a regular file`);
    }

    const verifiedRealPath = realpathSync(realPath);
    assertContained(projectRealPath, verifiedRealPath, label);
    const current = statSync(verifiedRealPath);

    if (opened.dev !== current.dev || opened.ino !== current.ino) {
      throw specPathInvalid(`${label} changed during validation`);
    }

    const content = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor);

    if (
      opened.dev !== afterRead.dev ||
      opened.ino !== afterRead.ino ||
      opened.size !== afterRead.size ||
      opened.mtimeMs !== afterRead.mtimeMs
    ) {
      throw specPathInvalid(`${label} changed while it was being read`);
    }

    return content;
  } catch (cause) {
    if (cause instanceof TaskcraftError) {
      throw cause;
    }
    throw specPathInvalid(`${label} cannot be read safely`, cause);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

export function assertRepositoryRelativePath(
  value: string,
  label: string,
): void {
  const segments = value.split("/");

  if (
    value.length === 0 ||
    isAbsolute(value) ||
    win32.parse(value).root.length > 0 ||
    value.includes("\\") ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw specPathInvalid(
      `${label} must be a canonical repository-relative path: ${value}`,
    );
  }
}

export function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (cause) {
    if (isFileSystemError(cause) && cause.code === "ENOENT") {
      return false;
    }
    throw specPathInvalid("The Spec Registry path cannot be inspected", cause);
  }
}
