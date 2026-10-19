// Read-only doctor check for post-completion Spec sedimentation facts.
//
// Kept beside doctor-spec.ts rather than inside it: the check owns its own
// table, its own failure envelope and its own invariant — that sedimenting
// never contributes an obligation or moves a task out of `done`.
//
// It validates the stored fact as a fact and deliberately does not compare it
// with today's Registry. A sedimentation is a note about what a finished task
// touched; re-checking it against the current Spec set would report history as
// damage, which is exactly the mistake this design removed.

import { ERROR_CODES } from "./errors.js";
import type { TaskcraftErrorCode } from "./errors.js";
import type { DoctorCheck } from "./doctor.js";
import { canonicalSpecIds } from "../store/spec-sedimentation-facts.js";
import type { TaskcraftDatabase } from "../store/database.js";

interface SedimentationRow {
  taskId: string;
  lifecycleRevision: number;
  specIdsJson: string;
  reason: string;
}

/** Read-only integrity check for post-completion sedimentation facts. It also
 * proves the surface stayed outside the completion contract: sedimenting must
 * never contribute an obligation. */
export function checkSpecSedimentation(
  database: TaskcraftDatabase,
): DoctorCheck {
  if (!hasSedimentationTable(database)) {
    // A store behind on migrations is a supported state: the migration-ledger
    // check names the pending files, and doctor must never leak "no such
    // table" as an internal failure.
    return failure(
      "spec-sedimentation",
      ERROR_CODES.TC_SPEC_SEDIMENTATION_INVALID,
      "The store has no spec_sedimentation_results table: its schema is older than the migrations on disk",
      "Post-completion Spec knowledge cannot be verified",
      "Apply the pending migrations by opening the store with any taskcraft command, then re-run: tc doctor",
    );
  }

  const problems: string[] = [];
  const rows = database
    .prepare(
      `SELECT task_id AS taskId, lifecycle_revision AS lifecycleRevision,
              spec_ids_json AS specIdsJson, reason
       FROM spec_sedimentation_results
       ORDER BY task_id, lifecycle_revision, spec_ids_json`,
    )
    .all() as SedimentationRow[];

  for (const row of rows) {
    const label = `${row.taskId} revision ${row.lifecycleRevision}`;
    const specIds = readSpecIds(row.specIdsJson, label, problems);

    if (row.reason.trim() === "") {
      problems.push(`${label}: empty reason`);
    }
    if (!hasLifecycleRevision(database, row.taskId, row.lifecycleRevision)) {
      problems.push(`${label}: unknown lifecycle revision`);
    }
    if (specIds !== null && canonicalSpecIds(specIds) !== row.specIdsJson) {
      problems.push(`${label}: Spec ids are not stored in canonical form`);
    }
  }

  problems.push(...sedimentationObligationProblems(database));

  return problems.length === 0
    ? { name: "spec-sedimentation", ok: true }
    : failure(
        "spec-sedimentation",
        ERROR_CODES.TC_SPEC_SEDIMENTATION_INVALID,
        `Invalid Spec sedimentation facts: ${problems.join("; ")}`,
        "Post-completion Spec knowledge cannot be trusted",
        "Repair or remove the damaged sedimentation fact, then re-run: tc doctor",
      );
}

/** Returns the stored Spec ids, or null when the row is already reported. */
function readSpecIds(
  specIdsJson: string,
  label: string,
  problems: string[],
): string[] | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(specIdsJson) as unknown;
  } catch {
    problems.push(`${label}: Spec ids are not valid JSON`);
    return null;
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((item) => typeof item === "string" && item.trim() !== "")
  ) {
    problems.push(`${label}: Spec ids must be a non-empty array of ids`);
    return null;
  }
  if (new Set(parsed).size !== parsed.length) {
    problems.push(`${label}: Spec ids repeat an id`);
    return null;
  }

  return parsed as string[];
}

function sedimentationObligationProblems(
  database: TaskcraftDatabase,
): string[] {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM obligation_definitions
       WHERE id = 'spec-sedimentation-recorded'
          OR evaluator_json LIKE '%spec-sedimentation%'`,
    )
    .get() as { count: number };

  return row.count === 0
    ? []
    : [
        "Spec sedimentation must not define completion obligations or change a projected status",
      ];
}

function hasSedimentationTable(database: TaskcraftDatabase): boolean {
  return (
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'spec_sedimentation_results'",
      )
      .get() !== undefined
  );
}

function hasLifecycleRevision(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
): boolean {
  return (
    database
      .prepare(
        `SELECT 1 FROM lifecycle_revisions
         WHERE task_id = ? AND revision = ?`,
      )
      .get(taskId, revision) !== undefined
  );
}

function failure(
  name: string,
  code: TaskcraftErrorCode,
  problem: string,
  impact: string,
  remediation: string,
): DoctorCheck {
  return { name, ok: false, error: { code, problem, impact, remediation } };
}
