import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openDatabase,
  type TaskcraftDatabase,
} from "../../src/store/database.js";
import { applyMigrations, MigrationError } from "../../src/store/migrations.js";
import {
  createTemporaryDirectory,
  type TemporaryDirectory,
} from "../helpers/temp-directory.js";
import { insertNode, insertTask } from "./helpers.js";

interface SchemaRow {
  type: string;
  name: string;
  tableName: string;
  sql: string | null;
}

describe("applyMigrations", () => {
  let database: TaskcraftDatabase | undefined;
  let temporaryDirectory: TemporaryDirectory | undefined;

  afterEach(() => {
    database?.close();
    temporaryDirectory?.cleanup();
  });

  it("applies the initial schema once and matches the contract snapshot", () => {
    database = openDatabase(":memory:");
    const migrationDirectory = resolve("migrations");

    applyMigrations(database, migrationDirectory);
    applyMigrations(database, migrationDirectory);

    expect(readLedgerCount(database)).toBe(5);
    expect(database.pragma("foreign_key_check")).toEqual([]);

    for (const table of [
      "lifecycle_acceptance_anchors",
      "lifecycle_execution_sources",
      "lifecycle_child_requirements",
      "lifecycle_anchor_coverage",
      "lifecycle_task_dependencies",
      "lifecycle_validation_assignments",
      "lifecycle_inherited_planning",
      "lifecycle_spec_bindings",
      "spec_impact_results",
      "spec_sedimentation_results",
    ]) {
      expect(hasTable(database, table)).toBe(true);
    }

    const contractDatabase = openDatabase(":memory:");

    try {
      contractDatabase.exec(readFileSync("src/contracts/storage.sql", "utf8"));
      expect(readSchema(database)).toEqual(readSchema(contractDatabase));
    } finally {
      contractDatabase.close();
    }
  });

  it("drops the retired byte-digest columns", () => {
    database = openDatabase(":memory:");
    applyMigrations(database, resolve("migrations"));

    // The ledger records which migrations ran, and a binding records which
    // documents a task adopted. Neither keeps a hash of file bytes.
    expect(columnNames(database, "schema_migrations")).toEqual([
      "version",
      "name",
      "applied_at",
    ]);
    expect(columnNames(database, "lifecycle_spec_bindings")).not.toContain(
      "spec_digest",
    );
  });

  it("upgrades 0001 -> 0005 without backfilling historical tasks", () => {
    temporaryDirectory = createTemporaryDirectory();
    database = openDatabase(":memory:");
    for (const filename of ["0001_initial.sql", "0002_l3_modular_tasks.sql"]) {
      writeMigration(
        filename,
        readFileSync(join("migrations", filename), "utf8"),
      );
    }
    applyMigrations(database, temporaryDirectory.path);
    insertTask(database, { id: "legacy-task", level: 1 });
    insertNode(database, "legacy-task", "execute-1", "execute");

    for (const filename of [
      "0003_spec_system.sql",
      "0004_spec_sedimentation.sql",
      "0005_drop_byte_digests.sql",
    ]) {
      writeMigration(
        filename,
        readFileSync(join("migrations", filename), "utf8"),
      );
    }
    applyMigrations(database, temporaryDirectory.path);

    expect(readLedgerCount(database)).toBe(5);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM lifecycle_spec_bindings WHERE task_id = 'legacy-task'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM spec_impact_results WHERE task_id = 'legacy-task'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM spec_sedimentation_results WHERE task_id = 'legacy-task'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  it("rejects an invalid migration filename before changing the database", () => {
    setupTemporaryMigration("1_invalid.sql", "CREATE TABLE invalid (id TEXT);");

    const error = captureMigrationError(() => {
      applyMigrations(database!, temporaryDirectory!.path);
    });

    expect(error.code).toBe("TC_STORE_MIGRATION_NAME_INVALID");
    expect(hasTable(database!, "schema_migrations")).toBe(false);
  });

  it("rejects duplicate migration versions", () => {
    setupTemporaryMigration("0001_first.sql", "SELECT 1;");
    writeMigration("0001_second.sql", "SELECT 2;");

    const error = captureMigrationError(() => {
      applyMigrations(database!, temporaryDirectory!.path);
    });

    expect(error.code).toBe("TC_STORE_MIGRATION_VERSION_DUPLICATE");
  });

  it("rejects a missing applied migration file", () => {
    setupTemporaryMigration("0001_first.sql", "CREATE TABLE first (id TEXT);");
    applyMigrations(database!, temporaryDirectory!.path);
    unlinkSync(join(temporaryDirectory!.path, "0001_first.sql"));

    const error = captureMigrationError(() => {
      applyMigrations(database!, temporaryDirectory!.path);
    });

    expect(error.code).toBe("TC_STORE_MIGRATION_HISTORY_MISSING");
  });

  it("does not treat an edited applied migration as a ledger error", () => {
    setupTemporaryMigration("0001_first.sql", "CREATE TABLE first (id TEXT);");
    applyMigrations(database!, temporaryDirectory!.path);
    writeMigration("0001_first.sql", "CREATE TABLE changed (id TEXT);");

    // The ledger records which migrations ran, not what their bytes were:
    // hashing the SQL would bind the store to the checkout's line endings, so
    // the same file hashes differently on LF and CRLF.
    applyMigrations(database!, temporaryDirectory!.path);
    expect(readLedgerCount(database!)).toBe(1);
  });

  it("rolls back a failed migration without writing its ledger row", () => {
    setupTemporaryMigration(
      "0001_broken.sql",
      "CREATE TABLE partial (id TEXT); INSERT INTO missing_table VALUES (1);",
    );

    const error = captureMigrationError(() => {
      applyMigrations(database!, temporaryDirectory!.path);
    });

    expect(error.code).toBe("TC_STORE_MIGRATION_APPLY_FAILED");
    expect(error.cause).toBeInstanceOf(Error);
    expect(hasTable(database!, "partial")).toBe(false);
    expect(readLedgerCount(database!)).toBe(0);
  });

  function setupTemporaryMigration(filename: string, sql: string): void {
    temporaryDirectory = createTemporaryDirectory();
    database = openDatabase(":memory:");
    writeMigration(filename, sql);
  }

  function writeMigration(filename: string, sql: string): void {
    writeFileSync(join(temporaryDirectory!.path, filename), sql, "utf8");
  }
});

function captureMigrationError(callback: () => void): MigrationError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationError);
    return error as MigrationError;
  }

  throw new Error("Expected migration to fail");
}

function readLedgerCount(database: TaskcraftDatabase): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
    .get() as { count: number };

  return row.count;
}

function columnNames(database: TaskcraftDatabase, table: string): string[] {
  return (
    database
      .prepare(`SELECT name FROM pragma_table_info(?)`)
      .all(table) as Array<{
      name: string;
    }>
  ).map((column) => column.name);
}

function hasTable(database: TaskcraftDatabase, name: string): boolean {
  return (
    database
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

function readSchema(database: TaskcraftDatabase): SchemaRow[] {
  const rows = database
    .prepare(
      `SELECT type, name, tbl_name AS tableName, sql
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
         AND name <> 'schema_migrations'
       ORDER BY type, name`,
    )
    .all() as SchemaRow[];

  // SQLite preserves source whitespace in sqlite_schema. The executable
  // contract cares about the same objects and SQL tokens, not whether the
  // consolidated snapshot wraps a foreign key on one line or three.
  return rows.map((row) => ({
    ...row,
    sql:
      row.sql
        ?.replace(/\s+/g, " ")
        .replace(/\s*([(),])\s*/g, "$1")
        .trim() ?? null,
  }));
}
