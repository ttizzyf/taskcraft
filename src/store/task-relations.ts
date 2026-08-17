// Read-only normalized L3 plan relations. This is the sole decoder used by
// the Projector, CLI, Watch and doctor.

import type { TaskcraftDatabase } from "./database.js";

export interface AcceptanceAnchorRow {
  taskId: string;
  lifecycleRevision: number;
  anchorId: string;
  text: string;
  disposition: "required" | "deferred" | "descope";
  reason: string | null;
}

export interface ChildRequirementRow {
  parentTaskId: string;
  parentLifecycleRevision: number;
  moduleKey: string;
  childTaskId: string;
  requirementStatus: "required" | "not_required";
  orderIndex: number;
  sourcePlanAttemptId: string;
}

export interface AnchorCoverageRow {
  parentTaskId: string;
  parentLifecycleRevision: number;
  anchorId: string;
  childTaskId: string;
}

export interface TaskDependencyRow {
  parentTaskId: string;
  parentLifecycleRevision: number;
  taskId: string;
  dependsOnTaskId: string;
}

export interface ValidationAssignmentRow {
  parentTaskId: string;
  parentLifecycleRevision: number;
  validationId: string;
  reference: string;
  ownerKind: "child" | "parent_integrate";
  ownerChildTaskId: string | null;
}

export interface ExecutionSourceRow {
  taskId: string;
  lifecycleRevision: number;
  mode: "modules" | "single";
  planningRevision: number;
  sourcePlanAttemptId: string;
  feasibilityReviewAttemptId: string;
}

export interface InheritedPlanningRow {
  childTaskId: string;
  childLifecycleRevision: number;
  parentTaskId: string;
  parentLifecycleRevision: number;
  moduleKey: string;
  sourcePlanAttemptId: string;
}

export interface TaskRelations {
  anchors: AcceptanceAnchorRow[];
  children: ChildRequirementRow[];
  coverage: AnchorCoverageRow[];
  dependencies: TaskDependencyRow[];
  validations: ValidationAssignmentRow[];
  executionSource: ExecutionSourceRow | null;
}

export function getTaskRelations(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
): TaskRelations {
  const anchors = database
    .prepare(
      `SELECT task_id AS taskId, lifecycle_revision AS lifecycleRevision,
              anchor_id AS anchorId, text, disposition, reason
       FROM lifecycle_acceptance_anchors
       WHERE task_id = ? AND lifecycle_revision = ?
       ORDER BY rowid`,
    )
    .all(taskId, revision) as AcceptanceAnchorRow[];
  const children = database
    .prepare(
      `SELECT parent_task_id AS parentTaskId,
              parent_lifecycle_revision AS parentLifecycleRevision,
              module_key AS moduleKey, child_task_id AS childTaskId,
              requirement_status AS requirementStatus,
              order_index AS orderIndex,
              source_plan_attempt_id AS sourcePlanAttemptId
       FROM lifecycle_child_requirements
       WHERE parent_task_id = ? AND parent_lifecycle_revision = ?
       ORDER BY order_index, child_task_id`,
    )
    .all(taskId, revision) as ChildRequirementRow[];
  const coverage = database
    .prepare(
      `SELECT parent_task_id AS parentTaskId,
              parent_lifecycle_revision AS parentLifecycleRevision,
              anchor_id AS anchorId, child_task_id AS childTaskId
       FROM lifecycle_anchor_coverage
       WHERE parent_task_id = ? AND parent_lifecycle_revision = ?
       ORDER BY anchor_id, child_task_id`,
    )
    .all(taskId, revision) as AnchorCoverageRow[];
  const dependencies = database
    .prepare(
      `SELECT parent_task_id AS parentTaskId,
              parent_lifecycle_revision AS parentLifecycleRevision,
              task_id AS taskId, depends_on_task_id AS dependsOnTaskId
       FROM lifecycle_task_dependencies
       WHERE parent_task_id = ? AND parent_lifecycle_revision = ?
       ORDER BY task_id, depends_on_task_id`,
    )
    .all(taskId, revision) as TaskDependencyRow[];
  const validations = database
    .prepare(
      `SELECT parent_task_id AS parentTaskId,
              parent_lifecycle_revision AS parentLifecycleRevision,
              validation_id AS validationId, reference,
              owner_kind AS ownerKind,
              owner_child_task_id AS ownerChildTaskId
       FROM lifecycle_validation_assignments
       WHERE parent_task_id = ? AND parent_lifecycle_revision = ?
       ORDER BY validation_id`,
    )
    .all(taskId, revision) as ValidationAssignmentRow[];
  const executionSource = database
    .prepare(
      `SELECT task_id AS taskId, lifecycle_revision AS lifecycleRevision,
              mode, planning_revision AS planningRevision,
              source_plan_attempt_id AS sourcePlanAttemptId,
              feasibility_review_attempt_id AS feasibilityReviewAttemptId
       FROM lifecycle_execution_sources
       WHERE task_id = ? AND lifecycle_revision = ?`,
    )
    .get(taskId, revision) as ExecutionSourceRow | undefined;

  return {
    anchors,
    children,
    coverage,
    dependencies,
    validations,
    executionSource: executionSource ?? null,
  };
}

export function getInheritedPlanning(
  database: TaskcraftDatabase,
  childTaskId: string,
  revision: number,
): InheritedPlanningRow | null {
  const row = database
    .prepare(
      `SELECT child_task_id AS childTaskId,
              child_lifecycle_revision AS childLifecycleRevision,
              parent_task_id AS parentTaskId,
              parent_lifecycle_revision AS parentLifecycleRevision,
              module_key AS moduleKey,
              source_plan_attempt_id AS sourcePlanAttemptId
       FROM lifecycle_inherited_planning
       WHERE child_task_id = ? AND child_lifecycle_revision = ?`,
    )
    .get(childTaskId, revision) as InheritedPlanningRow | undefined;
  return row ?? null;
}
