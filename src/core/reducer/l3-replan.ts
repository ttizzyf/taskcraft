import type { TaskcraftDatabase } from "../../store/database.js";
import { getTaskRelations } from "../../store/query.js";
import { insertEvent } from "./shared.js";

/** Appends not_required membership facts to a new L3 planning revision. Old
 * children and their attempts/evidence are deliberately left untouched. */
export function recordReplacedChildren(
  database: TaskcraftDatabase,
  taskId: string,
  oldRevision: number,
  newRevision: number,
  postTaskRevision: number,
  actor: string,
  now: string,
): void {
  const previous = getTaskRelations(
    database,
    taskId,
    oldRevision,
  ).children.filter((child) => child.requirementStatus === "required");
  const insert = database.prepare(
    `INSERT INTO lifecycle_child_requirements (
       parent_task_id, parent_lifecycle_revision, module_key, child_task_id,
       requirement_status, order_index, source_plan_attempt_id
     ) VALUES (?, ?, ?, ?, 'not_required', ?, ?)`,
  );
  for (const child of previous) {
    insert.run(
      taskId,
      newRevision,
      child.moduleKey,
      child.childTaskId,
      child.orderIndex,
      child.sourcePlanAttemptId,
    );
    insertEvent(database, {
      taskId,
      lifecycleRevision: newRevision,
      nodeId: null,
      attemptId: null,
      eventType: "l3.child_requirement_replaced",
      payload: {
        childTaskId: child.childTaskId,
        moduleKey: child.moduleKey,
        oldRevision,
        newRevision,
        requirementStatus: "not_required",
      },
      postTaskRevision,
      actorInstanceId: actor,
      host: null,
      occurredAt: now,
    });
  }
}
