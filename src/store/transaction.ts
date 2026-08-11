import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import type { TaskcraftDatabase } from "./database.js";

/**
 * Runs `fn` inside a single BEGIN IMMEDIATE transaction. On success the
 * transaction is COMMITted and the callback result is returned. If `fn`
 * throws, the transaction is ROLLBACKed and the error is wrapped in a
 * TC_STORE_TRANSACTION_FAILED TaskcraftError that keeps the original cause.
 *
 * Nesting is rejected explicitly: better-sqlite3 does not support nested
 * transactions, so an active outer transaction is never silently reused.
 */
export function withTransaction<T>(
  database: TaskcraftDatabase,
  fn: () => T,
): T {
  if (database.inTransaction) {
    throw new TaskcraftError(ERROR_CODES.TC_STORE_TRANSACTION_FAILED, {
      problem:
        "withTransaction cannot start a transaction because one is already active",
      impact:
        "SQLite has no nested transactions; joining the outer transaction would hide the commit boundary",
      remediation: "Run the command without wrapping it in another transaction",
    });
  }

  try {
    database.exec("BEGIN IMMEDIATE");
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (cause) {
    if (database.inTransaction) {
      database.exec("ROLLBACK");
    }

    // Reducer errors (CAS conflicts, reference validation, result schema
    // failures) carry stable TC_* codes and must reach the command boundary
    // untouched. Only unexpected failures are wrapped as store errors.
    if (cause instanceof TaskcraftError) {
      throw cause;
    }

    throw new TaskcraftError(ERROR_CODES.TC_STORE_TRANSACTION_FAILED, {
      problem: `Transaction failed and was rolled back: ${describeCause(cause)}`,
      impact:
        "No partial facts were committed; the database is unchanged by this transaction",
      remediation: "Fix the reported cause and retry the command",
      cause,
    });
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  return String(cause);
}
