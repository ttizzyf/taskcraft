import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openDatabase,
  type TaskcraftDatabase,
} from "../../src/store/database.js";
import {
  createTemporaryDirectory,
  type TemporaryDirectory,
} from "../helpers/temp-directory.js";

describe("openDatabase", () => {
  let database: TaskcraftDatabase | undefined;
  let temporaryDirectory: TemporaryDirectory | undefined;

  afterEach(() => {
    database?.close();
    temporaryDirectory?.cleanup();
  });

  it("applies the shared SQLite connection policy", () => {
    temporaryDirectory = createTemporaryDirectory();
    database = openDatabase(join(temporaryDirectory.path, "taskcraft.db"));

    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(database.pragma("busy_timeout", { simple: true })).toBe(5_000);
    expect(database.pragma("synchronous", { simple: true })).toBe(1);
  });

  it("accepts an in-memory database when WAL is unavailable", () => {
    database = openDatabase(":memory:");

    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("journal_mode", { simple: true })).toBe("memory");
  });
});
