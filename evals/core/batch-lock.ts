import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import { isProcessAlive } from "./job.ts";

const BATCH_LOCK_FILE = ".lock";

export interface BatchLock {
  token: string;
  release(): void;
}

export function acquireBatchLock(batchPath: string): BatchLock {
  const lockPath = join(dirname(batchPath), BATCH_LOCK_FILE);
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    try {
      const descriptor = openSync(lockPath, "wx", 0o600);
      try {
        writeSync(
          descriptor,
          `${JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() })}\n`,
          undefined,
          "utf8",
        );
      } finally {
        closeSync(descriptor);
      }
      return {
        token,
        release: () => releaseBatchLock(lockPath, token),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (lockOwnerAlive(lockPath)) {
        throw new Error(`batch is already active: ${dirname(batchPath)}`, {
          cause: error,
        });
      }
      try {
        unlinkSync(lockPath);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error("could not remove stale batch lock", {
            cause: unlinkError,
          });
        }
      }
    }
  }
  throw new Error(`could not acquire batch lock: ${dirname(batchPath)}`);
}

function lockOwnerAlive(lockPath: string): boolean {
  try {
    const value = JSON.parse(readFileSync(lockPath, "utf8")) as unknown;
    return (
      isRecord(value) &&
      typeof value.pid === "number" &&
      isProcessAlive(value.pid)
    );
  } catch {
    return false;
  }
}

function releaseBatchLock(lockPath: string, token: string): void {
  try {
    const value = JSON.parse(readFileSync(lockPath, "utf8")) as unknown;
    if (isRecord(value) && value.token === token) unlinkSync(lockPath);
  } catch {
    // A stale lock is recoverable on the next invocation.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
