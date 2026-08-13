// Read-only integrity checks behind `tc doctor`. Every check reads the Task
// Store with SELECT/PRAGMA and recomputes in memory; doctor never writes to
// the database, so a damaged store stays byte-identical across a run. Each
// failed check carries its stable TC_STORE_* error with problem/impact/
// remediation for the CLI to render.

import { createContractValidators } from "../contracts/schemas.js";
import type { TaskcraftDatabase } from "../store/database.js";
import {
  type AppliedMigration,
  discoverMigrations,
  MigrationError,
  validateAppliedHistory,
} from "../store/migrations.js";
import { listTasks } from "../store/query.js";
import { ERROR_CODES } from "./errors.js";
import type { TaskcraftErrorCode } from "./errors.js";
import { L1_FACTS_DIGEST, L1_POLICY_DIGEST } from "./lifecycle/l1.js";
import { project } from "./projector.js";

export interface DoctorError {
  code: TaskcraftErrorCode;
  problem: string;
  impact: string;
  remediation: string;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  /** Present exactly when the check failed. */
  error?: DoctorError;
}

/** Every field the projector must return for a rebuild to count as complete. */
const PROJECTION_FIELDS = [
  "status",
  "waitingReason",
  "nodeStatuses",
  "runnableNodes",
  "runningNode",
  "doneObligations",
  "totalObligations",
  "next",
  "breadcrumb",
] as const;

export function runDoctorChecks(
  database: TaskcraftDatabase,
  migrationsDirectory: string,
): DoctorCheck[] {
  if (!hasMigrationLedger(database)) {
    // A store file without the ledger table was never migrated: the schema is
    // missing so no other check can run. Report the one stable error instead
    // of leaking "no such table" as an internal failure.
    return [missingLedgerCheck()];
  }

  return [
    checkMigrationLedger(database, migrationsDirectory),
    checkForeignKeys(database),
    checkOrphanReferences(database),
    checkEventContinuity(database),
    checkDefinitionDigest(database),
    checkProjectionRebuild(database),
    checkBreadcrumbSchema(database),
  ];
}

function hasMigrationLedger(database: TaskcraftDatabase): boolean {
  return (
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
      )
      .get() !== undefined
  );
}

function missingLedgerCheck(): DoctorCheck {
  return failed(
    "migration-ledger",
    ERROR_CODES.TC_STORE_MIGRATION_LEDGER_INVALID,
    "The store has no migration ledger: the schema_migrations table is missing",
    "The store was never initialized or its migration ledger was dropped",
    "Restore the database from a backup, or re-initialize with: tc init",
  );
}

/** The migration ledger must match the migration files on disk in both
 * directions: every applied row exists with the same name and checksum, and
 * every disk migration is applied. Reuses the exact validation applyMigrations
 * runs, without applying anything. */
function checkMigrationLedger(
  database: TaskcraftDatabase,
  migrationsDirectory: string,
): DoctorCheck {
  try {
    const migrations = discoverMigrations(migrationsDirectory);
    const applied = database
      .prepare(
        "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
      )
      .all() as AppliedMigration[];

    validateAppliedHistory(applied, migrations);

    const appliedVersions = new Set(applied.map(({ version }) => version));
    const pending = migrations.filter(
      (migration) => !appliedVersions.has(migration.version),
    );

    if (pending.length > 0) {
      return failed(
        "migration-ledger",
        ERROR_CODES.TC_STORE_MIGRATION_LEDGER_INVALID,
        `Migration files not applied to the store: ${pending.map((migration) => migration.filename).join(", ")}`,
        "The store schema is older than the code expects",
        "Open the store with any taskcraft command (for example tc init) to apply the pending migrations",
      );
    }

    return ok("migration-ledger");
  } catch (error) {
    if (error instanceof MigrationError) {
      return failed(
        "migration-ledger",
        ERROR_CODES.TC_STORE_MIGRATION_LEDGER_INVALID,
        error.message,
        "The migration ledger does not match the migration files on disk",
        "Restore the matching migration files or the database backup, then re-run: tc doctor",
      );
    }

    throw error;
  }
}

/** PRAGMA foreign_key_check reports every row whose parent key is missing,
 * across all tables, regardless of whether foreign_keys was enabled when the
 * row was written. */
function checkForeignKeys(database: TaskcraftDatabase): DoctorCheck {
  const violations = database.pragma("foreign_key_check") as Array<{
    table: string;
    rowid: number;
    parent: string;
    fkid: number;
  }>;

  if (violations.length === 0) {
    return ok("foreign-keys");
  }

  const first = violations[0]!;
  const total =
    violations.length > 1 ? ` (${violations.length} violations total)` : "";

  return failed(
    "foreign-keys",
    ERROR_CODES.TC_STORE_FOREIGN_KEY_VIOLATION,
    `${first.table} row ${first.rowid} references a missing ${first.parent} row${total}`,
    "Rows reference tasks, attempts or definitions that no longer exist",
    "Restore the referenced rows from a backup, or rebuild the store from the audit events",
  );
}

/** Orphan rows reference a missing task/attempt/node even when the foreign
 * key constraints were not enforced at write time. Queries mirror the
 * storage.sql foreign key semantics for the four fact tables. */
function checkOrphanReferences(database: TaskcraftDatabase): DoctorCheck {
  const problems: string[] = [];

  for (const { table, sql } of ORPHAN_QUERIES) {
    const rows = database.prepare(sql).all() as Array<{ rowId: string }>;

    if (rows.length > 0) {
      problems.push(`${table}: ${rows.map((row) => row.rowId).join(", ")}`);
    }
  }

  if (problems.length === 0) {
    return ok("orphan-references");
  }

  return failed(
    "orphan-references",
    ERROR_CODES.TC_STORE_ORPHAN_REFERENCE,
    `Orphan references found in ${problems.join("; ")}`,
    "Evidence, task facts, blockers or review links point at missing parents",
    "Remove the orphan rows or restore the referenced facts from a backup",
  );
}

const ORPHAN_QUERIES: ReadonlyArray<{ table: string; sql: string }> = [
  {
    table: "evidence",
    sql: `SELECT e.id AS rowId FROM evidence AS e
          LEFT JOIN tasks AS task ON task.id = e.task_id
          LEFT JOIN node_attempts AS attempt
            ON attempt.id = e.node_attempt_id AND attempt.task_id = e.task_id
          WHERE task.id IS NULL
             OR (e.node_attempt_id IS NOT NULL AND attempt.id IS NULL)`,
  },
  {
    table: "task_facts",
    sql: `SELECT f.id AS rowId FROM task_facts AS f
          LEFT JOIN tasks AS task ON task.id = f.task_id
          LEFT JOIN node_attempts AS attempt
            ON attempt.id = f.source_attempt_id AND attempt.task_id = f.task_id
          LEFT JOIN evidence AS evidence_row
            ON evidence_row.id = f.evidence_id AND evidence_row.task_id = f.task_id
          LEFT JOIN task_facts AS superseded
            ON superseded.id = f.supersedes_fact_id AND superseded.task_id = f.task_id
          WHERE task.id IS NULL OR attempt.id IS NULL
             OR (f.evidence_id IS NOT NULL AND evidence_row.id IS NULL)
             OR (f.supersedes_fact_id IS NOT NULL AND superseded.id IS NULL)`,
  },
  {
    table: "blockers",
    sql: `SELECT b.id AS rowId FROM blockers AS b
          LEFT JOIN tasks AS task ON task.id = b.task_id
          LEFT JOIN lifecycle_nodes AS node
            ON node.task_id = b.task_id
           AND node.lifecycle_revision = b.lifecycle_revision
           AND node.id = b.node_id
          WHERE task.id IS NULL OR (b.node_id IS NOT NULL AND node.id IS NULL)`,
  },
  {
    table: "review_links",
    sql: `SELECT l.review_attempt_id AS rowId FROM review_links AS l
          LEFT JOIN tasks AS task ON task.id = l.task_id
          LEFT JOIN node_attempts AS review_attempt
            ON review_attempt.id = l.review_attempt_id
           AND review_attempt.task_id = l.task_id
          LEFT JOIN node_attempts AS reviewed_attempt
            ON reviewed_attempt.id = l.reviewed_attempt_id
           AND reviewed_attempt.task_id = l.task_id
          WHERE task.id IS NULL
             OR review_attempt.id IS NULL
             OR reviewed_attempt.id IS NULL`,
  },
];

/** Per-task task_seq must be exactly 1..n: with contiguous numbering the row
 * count equals the maximum sequence. Gaps (deleted events) or duplicates
 * break that equality; events are append-only, so any violation is damage. */
function checkEventContinuity(database: TaskcraftDatabase): DoctorCheck {
  const broken = database
    .prepare(
      `SELECT task_id AS taskId, COUNT(*) AS count, MAX(task_seq) AS maxSeq
       FROM events GROUP BY task_id HAVING COUNT(*) <> MAX(task_seq)`,
    )
    .all() as Array<{ taskId: string; count: number; maxSeq: number }>;

  if (broken.length === 0) {
    return ok("event-continuity");
  }

  const first = broken[0]!;
  const more = broken.length > 1 ? ` and ${broken.length - 1} more` : "";

  return failed(
    "event-continuity",
    ERROR_CODES.TC_STORE_EVENT_SEQUENCE_INVALID,
    `Task ${first.taskId} has ${first.count} events but the sequence reaches ${first.maxSeq}${more}`,
    "Audit events have gaps or duplicates, so the task history is incomplete",
    "Restore the missing events from a backup, or rebuild the task from its remaining facts",
  );
}

/** lifecycle_revisions stores the facts/policy digest the compiler computed
 * when the definition was materialized. The current compiler only compiles
 * from the empty fact set, so the expected digest is the SHA-256 of the empty
 * string; the L1 constants are exactly that recomputation. */
function checkDefinitionDigest(database: TaskcraftDatabase): DoctorCheck {
  const rows = database
    .prepare(
      `SELECT task_id AS taskId, revision,
              facts_digest AS factsDigest, policy_digest AS policyDigest
       FROM lifecycle_revisions`,
    )
    .all() as Array<{
    taskId: string;
    revision: number;
    factsDigest: string;
    policyDigest: string;
  }>;
  const problems: string[] = [];

  for (const row of rows) {
    if (
      row.factsDigest !== L1_FACTS_DIGEST ||
      row.policyDigest !== L1_POLICY_DIGEST
    ) {
      problems.push(`${row.taskId} revision ${row.revision}`);
    }
  }

  if (problems.length === 0) {
    return ok("definition-digest");
  }

  return failed(
    "definition-digest",
    ERROR_CODES.TC_STORE_DEFINITION_DIGEST_MISMATCH,
    `Lifecycle definition digests do not match the compiler output for ${problems.join(", ")}`,
    "The stored definition no longer corresponds to the facts it was compiled from",
    "Replan the affected tasks with: tc review replan <task-id> --finding <reason>",
  );
}

/** Every task must project without throwing and produce the full projection
 * shape; the breadcrumb contract is validated separately. project() throws on
 * facts it cannot interpret (for example corrupt result JSON), which is
 * exactly the kind of damage this check surfaces. */
function checkProjectionRebuild(database: TaskcraftDatabase): DoctorCheck {
  const problems: string[] = [];

  for (const task of listTasks(database)) {
    try {
      const projection = project(database, task.id) as unknown as Record<
        string,
        unknown
      >;
      const missing = PROJECTION_FIELDS.filter(
        (field) => projection[field] === undefined,
      );

      if (missing.length > 0) {
        problems.push(
          `${task.id}: projection is missing ${missing.join(", ")}`,
        );
      }
    } catch (error) {
      problems.push(`${task.id}: ${describeError(error)}`);
    }
  }

  if (problems.length === 0) {
    return ok("projection-rebuild");
  }

  return failed(
    "projection-rebuild",
    ERROR_CODES.TC_STORE_PROJECTION_FAILED,
    `Projection failed for ${problems.join("; ")}`,
    "Status, next commands or the breadcrumb cannot be derived for those tasks",
    "Inspect the task with: tc task show <task-id> --json",
  );
}

/** The breadcrumb each task produces must match the published contract
 * (development/contracts/breadcrumb.schema.json) through the same validator
 * the CLI uses. */
function checkBreadcrumbSchema(database: TaskcraftDatabase): DoctorCheck {
  const validators = createContractValidators();
  const problems: string[] = [];

  for (const task of listTasks(database)) {
    try {
      const { breadcrumb } = project(database, task.id);

      if (!validators.breadcrumb(breadcrumb)) {
        const firstError = validators.breadcrumb.errors?.[0];

        problems.push(
          firstError === undefined
            ? `${task.id}: breadcrumb does not match the contract schema`
            : `${task.id}: ${firstError.instancePath} ${firstError.message ?? "invalid value"}`,
        );
      }
    } catch (error) {
      problems.push(`${task.id}: ${describeError(error)}`);
    }
  }

  if (problems.length === 0) {
    return ok("breadcrumb-schema");
  }

  return failed(
    "breadcrumb-schema",
    ERROR_CODES.TC_STORE_BREADCRUMB_INVALID,
    `Breadcrumb schema violations: ${problems.join("; ")}`,
    "The breadcrumb contract cannot be delivered for those tasks",
    "Inspect the task with: tc task show <task-id> --json",
  );
}

function ok(name: string): DoctorCheck {
  return { name, ok: true };
}

function failed(
  name: string,
  code: TaskcraftErrorCode,
  problem: string,
  impact: string,
  remediation: string,
): DoctorCheck {
  return { name, ok: false, error: { code, problem, impact, remediation } };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
