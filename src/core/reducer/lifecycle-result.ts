import {
  Ajv2020,
  type AnySchema,
  type ValidateFunction,
} from "ajv/dist/2020.js";

import type { TaskcraftDatabase } from "../../store/database.js";

const validators = new Map<string, ValidateFunction>();

/** Validates against the immutable schema stored on the exact revision, so a
 * compiler bump never changes the completion contract of an old task. */
export function validateStoredNodeResult(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
  nodeId: string,
  result: unknown,
): boolean {
  const row = database
    .prepare(
      `SELECT output_schema_json AS outputSchemaJson
       FROM lifecycle_nodes
       WHERE task_id = ? AND lifecycle_revision = ? AND id = ?`,
    )
    .get(taskId, revision, nodeId) as { outputSchemaJson: string } | undefined;
  if (row === undefined) return false;
  let validator = validators.get(row.outputSchemaJson);
  if (validator === undefined) {
    validator = new Ajv2020({ strict: true, allErrors: true }).compile(
      JSON.parse(row.outputSchemaJson) as AnySchema,
    );
    validators.set(row.outputSchemaJson, validator);
  }
  return validator(result) === true;
}
