import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { SPEC_REGISTRY_RELATIVE_PATH } from "./types.js";

export function specRegistryInvalid(
  problem: string,
  cause?: unknown,
): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_SPEC_REGISTRY_INVALID, {
    problem,
    impact: "The Registry cannot be used for Spec discovery",
    remediation: `Fix ${SPEC_REGISTRY_RELATIVE_PATH}, then run: tc spec check`,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function specPathInvalid(
  problem: string,
  cause?: unknown,
): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_SPEC_PATH_INVALID, {
    problem,
    impact: "The Registry cannot be safely read",
    remediation:
      "Use a readable regular file with a canonical repository-relative path, then run: tc spec check",
    ...(cause === undefined ? {} : { cause }),
  });
}

export function isFileSystemError(
  cause: unknown,
): cause is NodeJS.ErrnoException {
  return cause instanceof Error && "code" in cause;
}
