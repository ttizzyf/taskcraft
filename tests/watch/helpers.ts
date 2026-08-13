// Shared watch server test harness: temp project setup (optionally loading a
// fixture), server boot on a random port and JSON GET helper. Kept separate
// so every watch test file stays under the per-file line budget.

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../../src/store/database.js";
import { applyMigrations } from "../../src/store/migrations.js";
import { createWatchServer } from "../../src/watch/server.js";
import type { WatchServerOptions } from "../../src/watch/server.js";
import { loadFixtureFile } from "../helpers/load-fixture.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

export const STATIC_DIRECTORY = fileURLToPath(
  new URL("../../watch", import.meta.url),
);

/** Creates a temp project, optionally loading a fixture into
 * .taskcraft/taskcraft.db, runs the callback and cleans up. */
export async function withProject(
  fixture: string | null,
  callback: (projectDir: string) => Promise<void>,
): Promise<void> {
  const temporary = createTemporaryDirectory();

  try {
    const projectDir = temporary.path;

    if (fixture !== null) {
      mkdirSync(join(projectDir, ".taskcraft"), { recursive: true });
      const database = openDatabase(
        join(projectDir, ".taskcraft", "taskcraft.db"),
      );

      try {
        applyMigrations(database, resolve("migrations"));
        loadFixtureFile(database, fixture);
      } finally {
        database.close();
      }
    }

    await callback(projectDir);
  } finally {
    temporary.cleanup();
  }
}

export async function withServer(
  projectDir: string,
  extra: Partial<WatchServerOptions>,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const { server, port } = await createWatchServer({
    projectDir,
    staticDir: STATIC_DIRECTORY,
    ...extra,
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await callback(baseUrl);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

export async function getJson(
  baseUrl: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: (await response.json()) as unknown };
}
