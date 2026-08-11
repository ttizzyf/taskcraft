import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import type { TaskcraftDatabase } from "../../src/store/database.js";
import { getTask } from "../../src/store/query.js";
import { withTransaction } from "../../src/store/transaction.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
  insertAttempt,
  insertNode,
  insertTask,
} from "./helpers.js";

describe("withTransaction", () => {
  it("commits writes performed inside the callback", () => {
    const database = createMigratedDatabase();

    try {
      withTransaction(database, () => {
        insertTask(database, { id: "task-commit" });
        insertNode(database, "task-commit", "execute-1", "execute");
        insertAttempt(database, "task-commit", "attempt-commit");
      });

      expect(countTasks(database)).toBe(1);
      expect(countAttempts(database)).toBe(1);
      expect(database.inTransaction).toBe(false);
    } finally {
      database.close();
    }
  });

  it("exposes writes to reads inside the same transaction", () => {
    const database = createMigratedDatabase();

    try {
      withTransaction(database, () => {
        insertTask(database, { id: "task-same-tx" });
        expect(getTask(database, "task-same-tx")?.id).toBe("task-same-tx");
      });
    } finally {
      database.close();
    }
  });

  it("rolls back every write when the callback throws", () => {
    const database = createMigratedDatabase();

    try {
      const error = captureTaskcraftError(() => {
        withTransaction(database, () => {
          insertTask(database, { id: "task-rollback" });
          insertNode(database, "task-rollback", "execute-1", "execute");
          insertAttempt(database, "task-rollback", "attempt-rollback");
          throw new Error("mid-transaction failure");
        });
      });

      expect(error.code).toBe(ERROR_CODES.TC_STORE_TRANSACTION_FAILED);
      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).toBe("mid-transaction failure");
      expect(countTasks(database)).toBe(0);
      expect(countAttempts(database)).toBe(0);
      expect(countLifecycleRevisions(database)).toBe(0);
      expect(database.inTransaction).toBe(false);
    } finally {
      database.close();
    }
  });

  it("rejects a nested transaction with a stable error", () => {
    const database = createMigratedDatabase();

    try {
      const error = captureTaskcraftError(() => {
        withTransaction(database, () => {
          insertTask(database, { id: "task-outer" });
          withTransaction(database, () => {
            insertTask(database, { id: "task-inner" });
          });
        });
      });

      expect(error.code).toBe(ERROR_CODES.TC_STORE_TRANSACTION_FAILED);
      expect(countTasks(database)).toBe(0);
      expect(database.inTransaction).toBe(false);
    } finally {
      database.close();
    }
  });

  it("returns the callback result on success", () => {
    const database = createMigratedDatabase();

    try {
      const result = withTransaction(database, () => "committed");

      expect(result).toBe("committed");
    } finally {
      database.close();
    }
  });
});

function countTasks(database: TaskcraftDatabase): number {
  const row = database.prepare("SELECT COUNT(*) AS count FROM tasks").get() as {
    count: number;
  };

  return row.count;
}

function countAttempts(database: TaskcraftDatabase): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM node_attempts")
    .get() as { count: number };

  return row.count;
}

function countLifecycleRevisions(database: TaskcraftDatabase): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM lifecycle_revisions")
    .get() as { count: number };

  return row.count;
}
