import Database from "better-sqlite3";

const BUSY_TIMEOUT_MILLISECONDS = 5_000;

export type TaskcraftDatabase = Database.Database;

export function openDatabase(filename: string): TaskcraftDatabase {
  const database = new Database(filename);

  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma(`busy_timeout = ${BUSY_TIMEOUT_MILLISECONDS}`);
  database.pragma("synchronous = NORMAL");

  return database;
}
