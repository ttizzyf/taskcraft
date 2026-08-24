import type { TaskcraftDatabase } from "../store/database.js";
import { getTaskRelations } from "../store/query.js";
import type { DoctorCheck } from "./doctor.js";
import { ERROR_CODES } from "./errors.js";

export function checkL3Relations(database: TaskcraftDatabase): DoctorCheck {
  const problems: string[] = [];
  const invalidHierarchy = database
    .prepare(
      `SELECT child.id AS childId, child.level, parent.parent_task_id AS grandparentId
       FROM tasks AS child
       JOIN tasks AS parent ON parent.id = child.parent_task_id
       WHERE child.level = 3 OR parent.parent_task_id IS NOT NULL`,
    )
    .all() as Array<{
    childId: string;
    level: number;
    grandparentId: string | null;
  }>;
  for (const child of invalidHierarchy) {
    problems.push(
      `${child.childId}: ${child.level === 3 ? "L3 child" : "nested child"}`,
    );
  }

  const executionSources = database
    .prepare(
      `SELECT task_id AS taskId, lifecycle_revision AS revision
       FROM lifecycle_execution_sources WHERE mode = 'modules'`,
    )
    .all() as Array<{ taskId: string; revision: number }>;
  for (const source of executionSources) {
    const relations = getTaskRelations(
      database,
      source.taskId,
      source.revision,
    );
    const requiredChildren = relations.children.filter(
      (child) => child.requirementStatus === "required",
    );
    if (requiredChildren.length < 2) {
      problems.push(
        `${source.taskId} revision ${source.revision}: fewer than two required children`,
      );
    }
    for (const anchor of relations.anchors) {
      if (
        anchor.disposition === "required" &&
        !relations.coverage.some(
          (coverage) => coverage.anchorId === anchor.anchorId,
        )
      ) {
        problems.push(
          `${source.taskId} revision ${source.revision}: uncovered anchor ${anchor.anchorId}`,
        );
      }
    }
    if (
      dependencyCycle(
        requiredChildren.map((child) => child.childTaskId),
        relations.dependencies,
      )
    ) {
      problems.push(
        `${source.taskId} revision ${source.revision}: dependency cycle`,
      );
    }
    for (const child of requiredChildren) {
      const invalid = database
        .prepare(
          `SELECT 1 FROM tasks AS task
           WHERE task.id = ?
             AND (task.parent_task_id <> ? OR task.level = 3)`,
        )
        .get(child.childTaskId, source.taskId);
      const provenance = database
        .prepare(
          `SELECT 1 FROM lifecycle_inherited_planning
           WHERE child_task_id = ? AND parent_task_id = ?`,
        )
        .get(child.childTaskId, source.taskId);
      if (invalid !== undefined || provenance === undefined) {
        problems.push(
          `${source.taskId} revision ${source.revision}: invalid child provenance ${child.childTaskId}`,
        );
      }
    }
  }

  const inherited = database
    .prepare(
      `SELECT inherited.child_task_id AS childTaskId,
              inherited.child_lifecycle_revision AS childRevision,
              inherited.parent_task_id AS parentTaskId,
              inherited.parent_lifecycle_revision AS parentRevision,
              inherited.module_key AS moduleKey,
              inherited.source_plan_attempt_id AS planAttemptId,
              child.parent_task_id AS actualParentTaskId,
              requirement.source_plan_attempt_id AS requirementPlanAttemptId,
              source.planning_revision AS planningRevision,
              source.source_plan_attempt_id AS executionPlanAttemptId,
              attempt.lifecycle_revision AS attemptRevision,
              attempt.status AS attemptStatus, attempt.outcome AS attemptOutcome,
              node.kind AS attemptKind
       FROM lifecycle_inherited_planning AS inherited
       LEFT JOIN tasks AS child ON child.id = inherited.child_task_id
       LEFT JOIN lifecycle_child_requirements AS requirement
         ON requirement.parent_task_id = inherited.parent_task_id
        AND requirement.parent_lifecycle_revision = inherited.parent_lifecycle_revision
        AND requirement.module_key = inherited.module_key
        AND requirement.child_task_id = inherited.child_task_id
       LEFT JOIN lifecycle_execution_sources AS source
         ON source.task_id = inherited.parent_task_id
        AND source.lifecycle_revision = inherited.parent_lifecycle_revision
       LEFT JOIN node_attempts AS attempt
         ON attempt.id = inherited.source_plan_attempt_id
        AND attempt.task_id = inherited.parent_task_id
       LEFT JOIN lifecycle_nodes AS node
         ON node.task_id = attempt.task_id
        AND node.lifecycle_revision = attempt.lifecycle_revision
        AND node.id = attempt.node_id`,
    )
    .all() as Array<{
    childTaskId: string;
    childRevision: number;
    parentTaskId: string;
    parentRevision: number;
    moduleKey: string;
    planAttemptId: string;
    actualParentTaskId: string | null;
    requirementPlanAttemptId: string | null;
    planningRevision: number | null;
    executionPlanAttemptId: string | null;
    attemptRevision: number | null;
    attemptStatus: string | null;
    attemptOutcome: string | null;
    attemptKind: string | null;
  }>;
  for (const row of inherited) {
    if (
      row.actualParentTaskId !== row.parentTaskId ||
      row.requirementPlanAttemptId !== row.planAttemptId ||
      row.executionPlanAttemptId !== row.planAttemptId ||
      row.attemptRevision !== row.planningRevision ||
      row.attemptKind !== "plan" ||
      row.attemptStatus !== "finished" ||
      row.attemptOutcome !== "success"
    ) {
      problems.push(
        `${row.childTaskId} revision ${row.childRevision}: inexact inherited Plan provenance for ${row.parentTaskId} revision ${row.parentRevision} module ${row.moduleKey}`,
      );
    }
  }

  return problems.length === 0
    ? { name: "l3-relations", ok: true }
    : {
        name: "l3-relations",
        ok: false,
        error: {
          code: ERROR_CODES.TC_STORE_INTEGRITY_FAILED,
          problem: `Invalid L3 relations: ${problems.join("; ")}`,
          impact:
            "Parent completion, dependency order or planning provenance cannot be trusted",
          remediation:
            "Inspect the affected parent with tc task show <task-id> --json and restore its accepted-plan facts",
        },
      };
}

function dependencyCycle(
  childIds: string[],
  dependencies: Array<{ taskId: string; dependsOnTaskId: string }>,
): boolean {
  const edges = new Map<string, string[]>();
  for (const dependency of dependencies) {
    edges.set(dependency.taskId, [
      ...(edges.get(dependency.taskId) ?? []),
      dependency.dependsOnTaskId,
    ]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    for (const dependency of edges.get(taskId) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };
  return childIds.some(visit);
}
