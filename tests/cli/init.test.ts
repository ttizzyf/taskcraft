import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/store/database.js";
import { runCli, withTemporaryDirectory } from "./helpers.js";

describe("tc init", () => {
  it("creates .taskcraft/ with a migrated database on first run", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["init"], cwd);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Initialized Taskcraft store");

      const databaseFile = join(cwd, ".taskcraft", "taskcraft.db");
      expect(existsSync(databaseFile)).toBe(true);

      const database = openDatabase(databaseFile);
      const ledger = database
        .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
        .get() as { count: number };
      expect(ledger.count).toBe(2);
      database.close();
    });
  });

  it("is idempotent and never overwrites existing store content", () => {
    withTemporaryDirectory((cwd) => {
      const first = runCli(["init"], cwd);
      expect(first.status).toBe(0);

      const databaseFile = join(cwd, ".taskcraft", "taskcraft.db");
      const database = openDatabase(databaseFile);
      database.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY)");
      database.prepare("INSERT INTO probe (id) VALUES (?)").run(1);
      database.close();
      writeFileSync(join(cwd, ".taskcraft", "user-file.txt"), "keep me");

      const again = runCli(["init"], cwd);
      expect(again.status).toBe(0);
      expect(again.stderr).toBe("");
      expect(again.stdout).toContain("Already initialized Taskcraft store");

      expect(
        readFileSync(join(cwd, ".taskcraft", "user-file.txt"), "utf8"),
      ).toBe("keep me");

      const reopened = openDatabase(databaseFile);
      const row = reopened.prepare("SELECT id FROM probe").get();
      expect(row).toEqual({ id: 1 });
      reopened.close();
    });
  });

  it("rejects store commands before init with TC_NOT_INITIALIZED", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["status"], cwd);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("TC_NOT_INITIALIZED");
      expect(result.stderr).toContain("tc init");
    });
  });
});
