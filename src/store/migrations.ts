import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { TaskcraftDatabase } from "./database.js";

const MIGRATION_NAME = /^(?<version>\d{4})_(?<name>[a-z0-9][a-z0-9_]*)\.sql$/;

// The ledger records which migrations ran, not what their bytes were. Hashing
// the SQL would bind the store to the checkout's line endings: the same file
// hashes differently on LF and CRLF, and the committed store would then refuse
// to open on another platform.
const CREATE_LEDGER_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  )
`;

export type MigrationErrorCode =
  | "TC_STORE_MIGRATION_NAME_INVALID"
  | "TC_STORE_MIGRATION_VERSION_DUPLICATE"
  | "TC_STORE_MIGRATION_HISTORY_MISSING"
  | "TC_STORE_MIGRATION_APPLY_FAILED";

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;

  constructor(
    code: MigrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MigrationError";
    this.code = code;
  }
}

interface MigrationFile {
  version: number;
  name: string;
  filename: string;
  sql: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
}

export function applyMigrations(
  database: TaskcraftDatabase,
  directory: string,
): void {
  const migrations = discoverMigrations(directory);
  database.exec(CREATE_LEDGER_SQL);

  const applied = database
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
    .all() as AppliedMigration[];

  validateAppliedHistory(applied, migrations);
  const appliedVersions = new Set(applied.map(({ version }) => version));

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      applyMigration(database, migration);
    }
  }
}

// Read-only validation reused by `tc doctor` so the migration ledger check
// compares the same files and rules as applyMigrations.
export function discoverMigrations(directory: string): MigrationFile[] {
  const migrationFiles = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => loadMigration(directory, entry.name));

  migrationFiles.sort((left, right) => left.version - right.version);

  for (let index = 1; index < migrationFiles.length; index += 1) {
    const previous = migrationFiles[index - 1]!;
    const current = migrationFiles[index]!;

    if (previous.version === current.version) {
      throw new MigrationError(
        "TC_STORE_MIGRATION_VERSION_DUPLICATE",
        `Migration version ${current.version.toString().padStart(4, "0")} is duplicated by ${previous.filename} and ${current.filename}`,
      );
    }
  }

  return migrationFiles;
}

function loadMigration(directory: string, filename: string): MigrationFile {
  const match = MIGRATION_NAME.exec(filename);
  const versionText = match?.groups?.version;
  const name = match?.groups?.name;

  if (versionText === undefined || name === undefined) {
    throw new MigrationError(
      "TC_STORE_MIGRATION_NAME_INVALID",
      `Invalid migration filename: ${filename}`,
    );
  }

  const sql = readFileSync(join(directory, filename), "utf8");

  return {
    version: Number(versionText),
    name,
    filename,
    sql,
  };
}

export function validateAppliedHistory(
  applied: AppliedMigration[],
  migrations: MigrationFile[],
): void {
  const migrationsByVersion = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );

  for (const ledgerEntry of applied) {
    const migration = migrationsByVersion.get(ledgerEntry.version);

    if (migration === undefined || migration.name !== ledgerEntry.name) {
      throw new MigrationError(
        "TC_STORE_MIGRATION_HISTORY_MISSING",
        `Applied migration ${ledgerEntry.version.toString().padStart(4, "0")}_${ledgerEntry.name}.sql is missing`,
      );
    }
  }
}

function applyMigration(
  database: TaskcraftDatabase,
  migration: MigrationFile,
): void {
  database.exec("BEGIN IMMEDIATE");

  try {
    database.exec(migration.sql);
    database
      .prepare(
        `INSERT INTO schema_migrations (version, name, applied_at)
         VALUES (?, ?, ?)`,
      )
      .run(migration.version, migration.name, new Date().toISOString());
    database.exec("COMMIT");
  } catch (cause) {
    if (database.inTransaction) {
      database.exec("ROLLBACK");
    }

    throw new MigrationError(
      "TC_STORE_MIGRATION_APPLY_FAILED",
      `Failed to apply migration ${migration.filename}`,
      { cause },
    );
  }
}
