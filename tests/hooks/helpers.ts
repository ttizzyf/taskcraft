// Shared layout for hook gate tests: a temporary project directory holding
// .taskcraft/config.json and, when requested, a migrated Task Store with
// scenario tasks. Gate IO is exercised against real files, never mocked.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { Projection } from "../../src/core/projector.js";
import type { TaskcraftDatabase } from "../../src/store/database.js";
import { openDatabase } from "../../src/store/database.js";
import { applyMigrations } from "../../src/store/migrations.js";

export const FIXED_TIMESTAMP = "2026-08-11T00:00:00.000Z";

export interface HookProject {
  dir: string;
  configPath: string;
  databasePath: string;
  cleanup(): void;
}

export function createHookProject(
  config: unknown,
  withStore: boolean,
): HookProject {
  const dir = mkdtempSync(join(tmpdir(), "taskcraft-hook-test-"));
  const configPath = join(dir, ".taskcraft", "config.json");
  const databasePath = join(dir, ".taskcraft", "taskcraft.db");

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config)}\n`, "utf8");

  if (withStore) {
    const database = createStoreAt(databasePath);
    database.close();
  }

  return {
    dir,
    configPath,
    databasePath,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Opens a file-backed migrated store (the gate opens the store the same way,
 * from the config path). */
export function createStoreAt(path: string): TaskcraftDatabase {
  const database = openDatabase(path);
  applyMigrations(database, resolve("migrations"));
  return database;
}

/** Minimal active projection for pure decision tests. */
export function activeProjection(
  overrides: Partial<Projection> = {},
): Projection {
  const projection: Projection = {
    status: "active",
    waitingReason: null,
    nodeStatuses: [],
    runnableNodes: ["execute-1"],
    runningNode: null,
    doneObligations: 0,
    totalObligations: 1,
    next: "tc run T-1 --node execute-1",
    breadcrumb: {
      schemaVersion: "tc-breadcrumb/v1",
      takeover: "active",
      task: {
        id: "T-1",
        level: 1,
        status: "active",
        taskRevision: 1,
        lifecycleRevision: 1,
        waitingReason: null,
        node: "execute-1",
        nodeKind: "execute",
      },
      blocked: [],
      next: { command: "tc run T-1 --node execute-1" },
      detailCommand: "tc task show T-1 --json",
    },
  };

  return { ...projection, ...overrides };
}

export function nonActiveProjection(
  status: "waiting" | "done" | "cancelled" | "queued",
): Projection {
  return activeProjection({ status, next: null });
}
