// Append-only access to post-completion Spec sedimentation facts.
//
// Split out of spec-facts.ts so the impact and sedimentation stores stay
// separately readable; both remain thin SQL wrappers over one table each.

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import type { TaskcraftDatabase } from "./database.js";

export interface SpecSedimentationRow {
  taskId: string;
  lifecycleRevision: number;
  /** Canonical JSON array of the Spec ids this task revision touched. */
  specIdsJson: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface InsertSpecSedimentationInput {
  taskId: string;
  lifecycleRevision: number;
  specIds: readonly string[];
  reason: string;
  actor: string;
  now: string;
}

/** Canonical storage form of the touched Spec ids. Sorting makes the natural
 * key stable whatever order the caller listed the ids in, which is what lets a
 * replayed list be recognised as the same fact without any content hash. */
export function canonicalSpecIds(specIds: readonly string[]): string {
  return JSON.stringify([...specIds].sort());
}

/** Appends one post-completion sedimentation fact. The row is identified by
 * (task, revision, canonical spec id list), so re-inserting the same list is a
 * no-op that reports false rather than duplicating or rewriting history. */
export function insertSpecSedimentationResult(
  database: TaskcraftDatabase,
  input: InsertSpecSedimentationInput,
): boolean {
  assertSedimentationFact(input);
  const result = database
    .prepare(
      `INSERT INTO spec_sedimentation_results (
         task_id, lifecycle_revision, spec_ids_json, reason, created_by,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(
      input.taskId,
      input.lifecycleRevision,
      canonicalSpecIds(input.specIds),
      input.reason,
      input.actor,
      input.now,
    );

  return result.changes > 0;
}

export function getSpecSedimentationResults(
  database: TaskcraftDatabase,
  taskId: string,
  revision?: number,
): SpecSedimentationRow[] {
  const select = `SELECT task_id AS taskId,
                         lifecycle_revision AS lifecycleRevision,
                         spec_ids_json AS specIdsJson, reason,
                         created_by AS createdBy, created_at AS createdAt
                  FROM spec_sedimentation_results`;

  // `created_at` has millisecond resolution, so two records written in the same
  // millisecond need a tiebreaker. rowid is insertion order for this
  // append-only table; the natural-key primary key would otherwise sort the
  // longer spec id list first.
  return (
    revision === undefined
      ? database
          .prepare(
            `${select} WHERE task_id = ?
             ORDER BY lifecycle_revision, created_at, rowid`,
          )
          .all(taskId)
      : database
          .prepare(
            `${select} WHERE task_id = ? AND lifecycle_revision = ?
             ORDER BY created_at, rowid`,
          )
          .all(taskId, revision)
  ) as SpecSedimentationRow[];
}

function assertSedimentationFact(input: InsertSpecSedimentationInput): void {
  const specIds = input.specIds;
  const validSpecIds =
    Array.isArray(specIds) &&
    specIds.length > 0 &&
    specIds.every(
      (specId) => typeof specId === "string" && specId.trim() !== "",
    ) &&
    new Set(specIds).size === specIds.length;

  if (
    input.taskId.trim() === "" ||
    input.reason.trim() === "" ||
    input.actor.trim() === "" ||
    !Number.isInteger(input.lifecycleRevision) ||
    input.lifecycleRevision < 1 ||
    !validSpecIds
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_SPEC_SEDIMENTATION_INVALID, {
      problem: "Spec sedimentation result is not a valid post-completion fact",
      impact: "No Spec sedimentation fact was written",
      remediation:
        "Record sediment with a non-empty reason and at least one Spec id: tc task spec sediment <task> --reason <reason> --spec <spec-id>",
      context: { taskId: input.taskId },
    });
  }
}
