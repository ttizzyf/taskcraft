import {
  parseSpecImpactResult,
  specImpactResultsEqual,
  type SpecImpactResult,
} from "../spec/index.js";
import type { TaskcraftDatabase } from "../store/database.js";
import {
  getEvidence,
  getSpecImpactResults,
  listTasks,
} from "../store/query.js";
import type { DoctorCheck } from "./doctor.js";
import { ERROR_CODES } from "./errors.js";
import { L1_COMPILER_VERSION, L1_OBLIGATION_IDS } from "./lifecycle/l1.js";
import { L2_COMPILER_VERSION } from "./lifecycle/l2.js";
import {
  L3_CHILD_COMPILER_VERSION,
  L3_COMPILER_VERSION,
} from "./lifecycle/l3.js";

const IMPACT_COMPILERS = new Set([
  L1_COMPILER_VERSION,
  L2_COMPILER_VERSION,
  L3_COMPILER_VERSION,
  L3_CHILD_COMPILER_VERSION,
]);

export function checkSpecImpact(database: TaskcraftDatabase): DoctorCheck {
  const problems: string[] = [];
  const impactByAttempt = new Set<string>();
  for (const task of listTasks(database)) {
    const evidence = new Map(
      getEvidence(database, task.id).map((item) => [item.id, item]),
    );
    for (const row of getSpecImpactResults(database, task.id)) {
      impactByAttempt.add(row.recordAttemptId);
      try {
        const details = parseDetails(row.detailsJson);
        const impact = parseSpecImpactResult({
          outcome: row.outcome,
          ...details,
        });
        const attempt = readRecordAttempt(database, row.recordAttemptId);
        if (
          attempt === undefined ||
          attempt.taskId !== task.id ||
          attempt.lifecycleRevision !== row.lifecycleRevision ||
          attempt.nodeId !== row.recordNodeId ||
          attempt.kind !== "record" ||
          attempt.status !== "finished" ||
          attempt.outcome !== "success"
        ) {
          problems.push(
            `${task.id} ${row.recordAttemptId}: not a successful Record attempt`,
          );
        } else {
          const submitted = parseAttemptImpact(attempt.resultJson);
          if (!specImpactResultsEqual(impact, submitted)) {
            problems.push(
              `${task.id} ${row.recordAttemptId}: result/Impact mismatch`,
            );
          }
        }
        if (impact.outcome === "updated") {
          const invalidEvidence = impact.updates.flatMap((update) =>
            update.evidenceRefs.filter((id) => {
              const item = evidence.get(id);
              return (
                item === undefined ||
                !["validation", "test", "artifact"].includes(item.type)
              );
            }),
          );
          if (invalidEvidence.length > 0) {
            problems.push(
              `${task.id} ${row.recordAttemptId}: foreign evidence or non-validation evidence ${[...new Set(invalidEvidence)].join(", ")}`,
            );
          }
        }
      } catch (error) {
        problems.push(
          `${task.id} ${row.recordAttemptId}: invalid schema or Record result (${describe(error)})`,
        );
      }
      if (!hasImpactObligation(database, task.id, row.lifecycleRevision)) {
        problems.push(
          `${task.id} ${row.recordAttemptId}: no compiler obligation`,
        );
      }
    }
  }
  const revisions = database
    .prepare(
      `SELECT revision.task_id AS taskId, revision.revision, revision.compiler_version AS compilerVersion,
              node.output_schema_json AS outputSchemaJson
       FROM lifecycle_revisions AS revision
       JOIN lifecycle_nodes AS node
         ON node.task_id = revision.task_id
        AND node.lifecycle_revision = revision.revision
        AND node.id = 'record-1'`,
    )
    .all() as Array<{
    taskId: string;
    revision: number;
    compilerVersion: string;
    outputSchemaJson: string;
  }>;
  for (const revision of revisions) {
    const expectsImpact = IMPACT_COMPILERS.has(revision.compilerVersion);
    const obligation = hasImpactObligation(
      database,
      revision.taskId,
      revision.revision,
    );
    if (expectsImpact !== obligation) {
      problems.push(
        `${revision.taskId} revision ${revision.revision}: compiler/obligation mismatch`,
      );
    }
    if (
      !matchesSpecImpactSchemaGeneration(
        revision.outputSchemaJson,
        expectsImpact,
      )
    ) {
      problems.push(
        `${revision.taskId} revision ${revision.revision}: compiler/Record schema mismatch`,
      );
    }
    const successful = database
      .prepare(
        `SELECT id FROM node_attempts
         WHERE task_id = ? AND lifecycle_revision = ? AND node_id = 'record-1'
           AND status = 'finished' AND outcome = 'success'`,
      )
      .all(revision.taskId, revision.revision) as Array<{ id: string }>;
    if (obligation) {
      // Obligations belong to a node/revision, while every successful Record
      // retains its own Impact. A successor does not replace first evidence.
      if (
        successful.length > 0 &&
        !hasSatisfiedImpactResult(database, revision.taskId, revision.revision)
      ) {
        problems.push(
          `${revision.taskId} revision ${revision.revision}: missing satisfied Spec Impact obligation result`,
        );
      }
      for (const attempt of successful) {
        if (!impactByAttempt.has(attempt.id)) {
          problems.push(
            `${revision.taskId} ${attempt.id}: missing Spec Impact`,
          );
        }
      }
    }
  }
  const executeSchemas = database
    .prepare(
      `SELECT revision.task_id AS taskId, revision.revision,
              revision.compiler_version AS compilerVersion,
              node.output_schema_json AS outputSchemaJson
       FROM lifecycle_revisions AS revision
       JOIN lifecycle_nodes AS node
         ON node.task_id = revision.task_id
        AND node.lifecycle_revision = revision.revision
        AND node.id = 'execute-1'`,
    )
    .all() as Array<{
    taskId: string;
    revision: number;
    compilerVersion: string;
    outputSchemaJson: string;
  }>;
  for (const execute of executeSchemas) {
    if (
      !matchesInlineRecordSpecImpactGeneration(
        execute.outputSchemaJson,
        IMPACT_COMPILERS.has(execute.compilerVersion),
      )
    ) {
      problems.push(
        `${execute.taskId} revision ${execute.revision}: compiler/Execute Record schema mismatch`,
      );
    }
  }
  const results = database
    .prepare(
      `SELECT task_id AS taskId, lifecycle_revision AS lifecycleRevision
       FROM obligation_results
       WHERE node_id = 'record-1' AND obligation_id = ?`,
    )
    .all(L1_OBLIGATION_IDS.specImpactRecorded) as Array<{
    taskId: string;
    lifecycleRevision: number;
  }>;
  for (const result of results) {
    if (
      !hasSatisfiedImpactResult(
        database,
        result.taskId,
        result.lifecycleRevision,
      )
    ) {
      problems.push(
        `${result.taskId} revision ${result.lifecycleRevision}: orphan Spec Impact obligation result`,
      );
    }
  }
  return problems.length === 0
    ? { name: "spec-impact", ok: true }
    : {
        name: "spec-impact",
        ok: false,
        error: {
          code: ERROR_CODES.TC_SPEC_IMPACT_INVALID,
          problem: `Invalid Spec Impact contract: ${problems.join("; ")}`,
          impact: "Record completion or Registry authority cannot be audited",
          remediation:
            "Repair the affected Record facts or Registry entries, then re-run: tc doctor",
        },
      };
}

interface RecordAttemptContract {
  taskId: string;
  lifecycleRevision: number;
  nodeId: string;
  kind: string;
  status: string;
  outcome: string | null;
  resultJson: string | null;
}

function readRecordAttempt(
  database: TaskcraftDatabase,
  attemptId: string,
): RecordAttemptContract | undefined {
  return database
    .prepare(
      `SELECT attempt.task_id AS taskId,
              attempt.lifecycle_revision AS lifecycleRevision,
              attempt.node_id AS nodeId, node.kind, attempt.status,
              attempt.outcome, attempt.result_json AS resultJson
       FROM node_attempts AS attempt
       JOIN lifecycle_nodes AS node
         ON node.task_id = attempt.task_id
        AND node.lifecycle_revision = attempt.lifecycle_revision
        AND node.id = attempt.node_id
       WHERE attempt.id = ?`,
    )
    .get(attemptId) as RecordAttemptContract | undefined;
}

function parseDetails(detailsJson: string): Record<string, unknown> {
  const value = JSON.parse(detailsJson) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("details_json is not an object");
  }
  return value as Record<string, unknown>;
}

function parseAttemptImpact(resultJson: string | null): SpecImpactResult {
  if (resultJson === null) throw new Error("Record result is missing");
  const value = JSON.parse(resultJson) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Record result is not an object");
  }
  return parseSpecImpactResult(
    (value as { specImpact?: unknown }).specImpact,
    "Stored Record Spec Impact",
  );
}

function matchesSpecImpactSchemaGeneration(
  outputSchemaJson: string,
  expectsImpact: boolean,
): boolean {
  try {
    return matchesSpecImpactSchema(
      JSON.parse(outputSchemaJson) as unknown,
      expectsImpact,
    );
  } catch {
    return false;
  }
}

function matchesInlineRecordSpecImpactGeneration(
  outputSchemaJson: string,
  expectsImpact: boolean,
): boolean {
  try {
    const schema = JSON.parse(outputSchemaJson) as {
      $defs?: { record?: unknown };
    };
    return matchesSpecImpactSchema(schema.$defs?.record, expectsImpact);
  } catch {
    return false;
  }
}

function matchesSpecImpactSchema(
  schema: unknown,
  expectsImpact: boolean,
): boolean {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return false;
  }
  const typed = schema as { required?: unknown; properties?: unknown };
  const required = Array.isArray(typed.required)
    ? typed.required.includes("specImpact")
    : false;
  const properties =
    typeof typed.properties === "object" && typed.properties !== null
      ? typed.properties
      : {};
  const declared = "specImpact" in properties;
  return expectsImpact ? required && declared : !required && !declared;
}

function hasSatisfiedImpactResult(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
): boolean {
  return (
    database
      .prepare(
        `SELECT 1 FROM obligation_results AS result
         JOIN evidence
           ON evidence.id = result.satisfied_by_evidence_id
          AND evidence.task_id = result.task_id
         WHERE result.task_id = ? AND result.lifecycle_revision = ?
           AND result.node_id = 'record-1' AND result.obligation_id = ?
           AND result.status = 'satisfied'
           AND EXISTS (
             SELECT 1 FROM node_attempts AS attempt
             JOIN lifecycle_nodes AS node
               ON node.task_id = attempt.task_id
              AND node.lifecycle_revision = attempt.lifecycle_revision
              AND node.id = attempt.node_id
             JOIN spec_impact_results AS impact
               ON impact.record_attempt_id = attempt.id
              AND impact.task_id = attempt.task_id
              AND impact.lifecycle_revision = attempt.lifecycle_revision
              AND impact.record_node_id = attempt.node_id
             WHERE attempt.id = evidence.node_attempt_id
               AND attempt.task_id = result.task_id
               AND attempt.lifecycle_revision = result.lifecycle_revision
               AND attempt.node_id = result.node_id
               AND node.kind = 'record'
               AND attempt.status = 'finished' AND attempt.outcome = 'success'
           )`,
      )
      .get(taskId, revision, L1_OBLIGATION_IDS.specImpactRecorded) !== undefined
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasImpactObligation(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
): boolean {
  return (
    database
      .prepare(
        `SELECT 1 FROM obligation_definitions
         WHERE task_id = ? AND lifecycle_revision = ? AND node_id = 'record-1' AND id = ?`,
      )
      .get(taskId, revision, L1_OBLIGATION_IDS.specImpactRecorded) !== undefined
  );
}
