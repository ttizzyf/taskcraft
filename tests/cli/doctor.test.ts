import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/store/database.js";
import {
  parseJson,
  runCli,
  withInitializedDirectory,
  withTemporaryDirectory,
} from "./helpers.js";

const FIXED_TIMESTAMP = "2026-08-13T00:00:00.000Z";

interface DoctorData {
  healthy: boolean;
  totalChecks: number;
  failedChecks: number;
  checks: Array<{
    name: string;
    ok: boolean;
    error?: {
      code: string;
      problem: string;
      impact: string;
      remediation: string;
    };
  }>;
}

interface DoctorFailure {
  ok: false;
  data: null;
  errors: Array<{
    code: string;
    problem: string;
    impact: string;
    remediation: string;
  }>;
}

function newTask(cwd: string, level: string): void {
  const result = runCli(
    ["task", "new", "--title", "t", "--level", level, "--reason", "r"],
    cwd,
  );
  expect(result.status).toBe(0);
}

function databaseFile(cwd: string): string {
  return join(cwd, ".taskcraft", "taskcraft.db");
}

describe("tc doctor", () => {
  it("passes with exit 0 on a healthy store", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "1");
      newTask(cwd, "2");
      newTask(cwd, "3");

      const text = runCli(["doctor"], cwd);
      expect(text.status).toBe(0);
      expect(text.stdout).toContain("Doctor: 7 checks passed");
      expect(text.stderr).toBe("");

      const result = runCli(["doctor", "--json"], cwd);
      expect(result.status).toBe(0);
      const json = parseJson<{ ok: boolean; data: DoctorData }>(result);
      expect(json.ok).toBe(true);
      expect(json.data.healthy).toBe(true);
      expect(json.data.totalChecks).toBe(7);
      expect(json.data.failedChecks).toBe(0);
      expect(json.data.checks.every((check) => check.ok)).toBe(true);
    });
  });

  it("fails with a stable error on a damaged store without modifying it", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "1");
      const file = databaseFile(cwd);

      const database = openDatabase(file);
      database.exec("DROP TRIGGER events_task_sequence_insert");
      database
        .prepare(
          `INSERT INTO events (
             event_id, task_id, task_seq, lifecycle_revision, node_id,
             attempt_id, actor_instance_id, host, event_type, payload_json,
             post_task_revision, occurred_at
           ) VALUES ('event-gap', 'T-1', 3, 1, NULL, NULL, 'cli', NULL,
             'doctor.test', '{}', 1, ?)`,
        )
        .run(FIXED_TIMESTAMP);
      database.close();

      const before = readFileSync(file);
      const result = runCli(["doctor"], cwd);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "error: TC_STORE_EVENT_SEQUENCE_INVALID:",
      );
      expect(result.stdout).toContain("impact:");
      expect(result.stdout).toContain("remediation:");
      expect(readFileSync(file)).toEqual(before);
    });
  });

  it("reports failed checks with stable errors in --json mode", () => {
    withInitializedDirectory((cwd) => {
      newTask(cwd, "1");

      const database = openDatabase(databaseFile(cwd));
      database.exec("DROP TRIGGER lifecycle_revisions_immutable_update");
      database
        .prepare(
          "UPDATE lifecycle_revisions SET policy_digest = 'tampered' WHERE task_id = 'T-1'",
        )
        .run();
      database.close();

      const result = runCli(["doctor", "--json"], cwd);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      const json = JSON.parse(result.stderr) as DoctorFailure;
      expect(json.ok).toBe(false);
      expect(json.data).toBeNull();
      expect(json.errors).toHaveLength(1);
      expect(json.errors[0]?.code).toBe("TC_STORE_DEFINITION_DIGEST_MISMATCH");
      expect(json.errors[0]?.problem).toBeTruthy();
      expect(json.errors[0]?.impact).toBeTruthy();
      expect(json.errors[0]?.remediation).toBeTruthy();
    });
  });

  it("fails with a stable error on a store file that was never migrated", () => {
    withInitializedDirectory((cwd) => {
      // Replace the migrated store with an empty file: half-initialized.
      const file = databaseFile(cwd);
      rmSync(file, { force: true });
      rmSync(`${file}-wal`, { force: true });
      rmSync(`${file}-shm`, { force: true });

      const database = openDatabase(file);
      database.close();

      const result = runCli(["doctor", "--json"], cwd);
      expect(result.status).toBe(1);

      expect(result.stdout).toBe("");
      const json = JSON.parse(result.stderr) as DoctorFailure;
      expect(json.ok).toBe(false);
      expect(json.data).toBeNull();
      expect(json.errors[0]?.code).toBe("TC_STORE_MIGRATION_LEDGER_INVALID");
    });
  });

  it("fails with TC_NOT_INITIALIZED and creates nothing when uninitialized", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["doctor"], cwd);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("TC_NOT_INITIALIZED");
      expect(result.stderr).toContain("tc init");
      expect(existsSync(join(cwd, ".taskcraft"))).toBe(false);
    });
  });
});
