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

    expect(readLedgerCount(database)).toBe(2);
    expect(database.pragma("foreign_key_check")).toEqual([]);

    for (const table of [
      "lifecycle_acceptance_anchors",
      "lifecycle_execution_sources",
      "lifecycle_child_requirements",
      "lifecycle_anchor_coverage",
      "lifecycle_task_dependencies",
      "lifecycle_validation_assignments",
      "lifecycle_inherited_planning",
    ]) {
      expect(hasTable(database, table)).toBe(true);
    }

    const contractDatabase = openDatabase(":memory:");

    try {
      contractDatabase.exec(
        readFileSync("development/contracts/storage.sql", "utf8"),
      );
      expect(readSchema(database)).toEqual(readSchema(contractDatabase));
    } finally {
      contractDatabase.close();
    }
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

  it("rejects checksum drift in an applied migration", () => {
    setupTemporaryMigration("0001_first.sql", "CREATE TABLE first (id TEXT);");
    applyMigrations(database!, temporaryDirectory!.path);
    writeMigration("0001_first.sql", "CREATE TABLE changed (id TEXT);");

    const error = captureMigrationError(() => {
      applyMigrations(database!, temporaryDirectory!.path);
    });

    expect(error.code).toBe("TC_STORE_MIGRATION_CHECKSUM_MISMATCH");
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
