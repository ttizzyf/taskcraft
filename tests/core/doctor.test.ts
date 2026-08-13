import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runDoctorChecks, type DoctorCheck } from "../../src/core/doctor.js";
import { taskNew } from "../../src/core/reducer.js";
import { openDatabase } from "../../src/store/database.js";
import type { TaskcraftDatabase } from "../../src/store/database.js";
import { createMigratedDatabase } from "../store/helpers.js";

const MIGRATIONS_DIRECTORY = resolve("migrations");
const FIXED_TIMESTAMP = "2026-08-13T00:00:00.000Z";

function checksOf(database: TaskcraftDatabase): DoctorCheck[] {
  return runDoctorChecks(database, MIGRATIONS_DIRECTORY);
}

function checkOf(database: TaskcraftDatabase, name: string): DoctorCheck {
  const check = checksOf(database).find((candidate) => candidate.name === name);

  expect(check, `check ${name}`).toBeDefined();
  return check!;
}

describe("runDoctorChecks", () => {
  it("passes all seven checks on a migrated empty store", () => {
    const database = createMigratedDatabase();

    try {
      const checks = checksOf(database);

      expect(checks).toHaveLength(7);
      for (const check of checks) {
        expect(check.ok, check.name).toBe(true);
        expect(check.error).toBeUndefined();
      }
    } finally {
      database.close();
    }
  });

  it("passes all seven checks on L1/L2/L3 tasks created through the reducer", () => {
    const database = createMigratedDatabase();

    try {
      taskNew(database, { title: "L1 task", level: 1, reason: "r" });
      taskNew(database, { title: "L2 task", level: 2, reason: "r" });
      taskNew(database, { title: "L3 task", level: 3, reason: "r" });

      const checks = checksOf(database);
      expect(checks.every((check) => check.ok)).toBe(true);
    } finally {
      database.close();
    }
  });

  it("flags a store file that was never migrated", () => {
    const database = openDatabase(":memory:");

    try {
      database.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
      const checks = checksOf(database);

      expect(checks).toHaveLength(1);
      expect(checks[0]?.name).toBe("migration-ledger");
      expect(checks[0]?.ok).toBe(false);
      expect(checks[0]?.error?.code).toBe("TC_STORE_MIGRATION_LEDGER_INVALID");
    } finally {
      database.close();
    }
  });

  it("flags an event sequence gap with a stable error", () => {
    const database = createMigratedDatabase();

    try {
      taskNew(database, { title: "Gapped task", level: 1, reason: "r" });
      database.exec("DROP TRIGGER events_task_sequence_insert");
      insertEvent(database, "event-gap", 3);

      const check = checkOf(database, "event-continuity");
      expect(check.ok).toBe(false);
      expect(check.error?.code).toBe("TC_STORE_EVENT_SEQUENCE_INVALID");
      expect(check.error?.problem).toContain("T-1");
      expect(check.error?.problem).toContain("2 events");
      expect(check.error?.impact).toBeTruthy();
      expect(check.error?.remediation).toBeTruthy();
    } finally {
      database.close();
    }
  });

  it("flags rows whose parent task was removed", () => {
    const database = createMigratedDatabase();

    try {
      taskNew(database, { title: "Removed task", level: 1, reason: "r" });
      database.pragma("foreign_keys = OFF");
      database.prepare("DELETE FROM tasks WHERE id = 'T-1'").run();
      database.pragma("foreign_keys = ON");

      const check = checkOf(database, "foreign-keys");
      expect(check.ok).toBe(false);
      expect(check.error?.code).toBe("TC_STORE_FOREIGN_KEY_VIOLATION");
    } finally {
      database.close();
    }
  });

  it("flags evidence pointing at a missing attempt", () => {
    const database = createMigratedDatabase();

    try {
      taskNew(database, { title: "Orphan task", level: 1, reason: "r" });
      database.pragma("foreign_keys = OFF");
      database
        .prepare(
          `INSERT INTO evidence (
             id, task_id, node_attempt_id, type, reference, summary, digest,
             created_by, created_at
           ) VALUES ('orphan-evidence', 'T-1', 'missing-attempt', 'note',
             'ref://orphan', 'Orphan row', NULL, 'cli', ?)`,
        )
        .run(FIXED_TIMESTAMP);
      database.pragma("foreign_keys = ON");

      const check = checkOf(database, "orphan-references");
      expect(check.ok).toBe(false);
      expect(check.error?.code).toBe("TC_STORE_ORPHAN_REFERENCE");
      expect(check.error?.problem).toContain("orphan-evidence");
    } finally {
      database.close();
    }
  });

  it("flags a tampered lifecycle definition digest", () => {
    const database = createMigratedDatabase();

    try {
      taskNew(database, { title: "Tampered task", level: 2, reason: "r" });
      database.exec("DROP TRIGGER lifecycle_revisions_immutable_update");
      database
        .prepare(
          "UPDATE lifecycle_revisions SET facts_digest = 'tampered' WHERE task_id = 'T-1'",
        )
        .run();

      const check = checkOf(database, "definition-digest");
      expect(check.ok).toBe(false);
      expect(check.error?.code).toBe("TC_STORE_DEFINITION_DIGEST_MISMATCH");
      expect(check.error?.problem).toContain("T-1 revision 1");
    } finally {
      database.close();
    }
  });

  it("flags a task whose projection throws on corrupt result JSON", () => {
    const database = createMigratedDatabase();

    try {
      taskNew(database, { title: "Broken projection", level: 3, reason: "r" });
      database
        .prepare(
          `INSERT INTO node_attempts (
             id, task_id, lifecycle_revision, node_id, attempt_number,
             actor_instance_id, host, status, outcome, result_json,
             started_at, finished_at
           ) VALUES ('att-integrate-1', 'T-1', 1, 'integrate-1', 1, 'cli',
             'host-1', 'finished', 'success', '{not json', ?, ?)`,
        )
        .run(FIXED_TIMESTAMP, FIXED_TIMESTAMP);

      const check = checkOf(database, "projection-rebuild");
      expect(check.ok).toBe(false);
      expect(check.error?.code).toBe("TC_STORE_PROJECTION_FAILED");
      expect(check.error?.problem).toContain("T-1");
    } finally {
      database.close();
    }
  });

  it("flags a breadcrumb that violates the contract schema", () => {
    const database = createMigratedDatabase();

    try {
      taskNew(database, { title: "Blocked task", level: 1, reason: "r" });
      const insertBlocker = database.prepare(
        `INSERT INTO blockers (
           id, task_id, lifecycle_revision, node_id, kind, waiting_reason,
           status, reason, remediation_command, created_at, resolved_at
         ) VALUES (?, 'T-1', 1, 'execute-1', 'needs_input', 'needs_input',
           'open', 'Blocked', 'tc task show T-1', ?, NULL)`,
      );

      // Four open blockers overflow breadcrumb.blocked (maxItems 3).
      for (const index of [1, 2, 3, 4]) {
        insertBlocker.run(`blocker-${index}`, FIXED_TIMESTAMP);
      }

      const check = checkOf(database, "breadcrumb-schema");
      expect(check.ok).toBe(false);
      expect(check.error?.code).toBe("TC_STORE_BREADCRUMB_INVALID");
      expect(check.error?.problem).toContain("T-1");
    } finally {
      database.close();
    }
  });
});

function insertEvent(
  database: TaskcraftDatabase,
  eventId: string,
  taskSeq: number,
): void {
  database
    .prepare(
      `INSERT INTO events (
         event_id, task_id, task_seq, lifecycle_revision, node_id,
         attempt_id, actor_instance_id, host, event_type, payload_json,
         post_task_revision, occurred_at
       ) VALUES (?, 'T-1', ?, 1, NULL, NULL, 'cli', NULL, 'doctor.test',
         '{}', 1, ?)`,
    )
    .run(eventId, taskSeq, FIXED_TIMESTAMP);
}
