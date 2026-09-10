import {
  Ajv2020,
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";

import { ERROR_CODES, TaskcraftError } from "../errors.js";
import type { TaskcraftDatabase } from "../../store/database.js";

const validators = new Map<string, ValidateFunction>();

/** Validates against the immutable schema stored on the exact revision, so a
 * compiler bump never changes the completion contract of an old task. */
export function storedNodeResultIssues(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
  nodeId: string,
  result: unknown,
): string[] {
  const row = database
    .prepare(
      `SELECT output_schema_json AS outputSchemaJson
       FROM lifecycle_nodes
       WHERE task_id = ? AND lifecycle_revision = ? AND id = ?`,
    )
    .get(taskId, revision, nodeId) as { outputSchemaJson: string } | undefined;
  if (row === undefined)
    return ["/ [schema]: stored node result schema is missing"];
  let validator = validators.get(row.outputSchemaJson);
  if (validator === undefined) {
    validator = new Ajv2020({ strict: true, allErrors: true }).compile(
      JSON.parse(row.outputSchemaJson) as AnySchema,
    );
    validators.set(row.outputSchemaJson, validator);
  }
  return validator(result) === true ? [] : validator.errors!.map(formatIssue);
}

function formatIssue(error: ErrorObject): string {
  const property =
    error.keyword === "required"
      ? (error.params.missingProperty as string)
      : error.keyword === "additionalProperties"
        ? (error.params.additionalProperty as string)
        : undefined;
  const path =
    property === undefined
      ? error.instancePath
      : `${error.instancePath}/${property.replace(/~/g, "~0").replace(/\//g, "~1")}`;
  return `${path || "/"} [${error.keyword}]: ${error.message ?? "constraint failed"}`;
}

/** Read-only integrity consumers share the exact cached validator. */
export function validateStoredNodeResult(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
  nodeId: string,
  result: unknown,
): boolean {
  return (
    storedNodeResultIssues(database, taskId, revision, nodeId, result)
      .length === 0
  );
}

export function assertStoredNodeResult(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
  nodeId: string,
  result: unknown,
): void {
  const issues = storedNodeResultIssues(
    database,
    taskId,
    revision,
    nodeId,
    result,
  );
  if (issues.length === 0) return;
  throw new TaskcraftError(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID, {
    problem: `Result for ${nodeId} failed the node result schema: ${issues.join("; ")}`,
    impact: "No facts were written; the task keeps its current state",
    remediation: `Read the current Node Brief and result schema with: tc task show ${taskId} --json; if ${nodeId} is not claimed, use: tc run ${taskId} --node ${nodeId}`,
    context: { taskId, nodeId },
  });
}
