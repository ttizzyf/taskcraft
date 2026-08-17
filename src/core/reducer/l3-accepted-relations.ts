import type { TaskcraftDatabase } from "../../store/database.js";
import { getTask } from "../../store/query.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import type {
  L3ModuleProposal,
  L3PlanResult,
} from "../lifecycle/l3-contract.js";

export interface MaterializedL3Child {
  moduleKey: string;
  taskId: string;
  level: 1 | 2;
  reused: boolean;
}

export function resolveReusableChildren(
  database: TaskcraftDatabase,
  parent: TaskSnapshot,
  modules: L3ModuleProposal[],
): Map<string, TaskSnapshot> {
  const result = new Map<string, TaskSnapshot>();
  const problems: string[] = [];
  const historicalChild = database.prepare(
    `SELECT 1
     FROM lifecycle_child_requirements
     WHERE parent_task_id = ?
       AND child_task_id = ?
       AND parent_lifecycle_revision <= ?
     LIMIT 1`,
  );

  for (const module of modules) {
    if (module.reuseTaskId === undefined) continue;

    const child = getTask(database, module.reuseTaskId);
    if (
      child === null ||
      child.parentTaskId !== parent.id ||
      historicalChild.get(
        parent.id,
        module.reuseTaskId,
        parent.currentLifecycleRevision,
      ) === undefined
    ) {
      problems.push(
        `module ${module.key} cannot reuse ${module.reuseTaskId}: it is not a historical child of ${parent.id}`,
      );
      continue;
    }

    const mismatches = moduleContractMismatches(child, module);
    if (mismatches.length > 0) {
      problems.push(
        `module ${module.key} cannot reuse ${child.id}: ${mismatches.join(", ")} changed`,
      );
      continue;
    }

    result.set(module.key, child);
  }

  if (problems.length > 0) throw invalidL3Plan(parent.id, problems);
  return result;
}

function moduleContractMismatches(
  child: TaskSnapshot,
  module: L3ModuleProposal,
): string[] {
  const mismatches: string[] = [];
  if (child.level !== module.level) mismatches.push("level");
  if (child.title !== module.title) mismatches.push("title");
  if (child.objectiveMd !== module.objective) mismatches.push("objective");
  if (!sameJson(child.scopeJson, module.scope)) mismatches.push("scope");
  if (!sameJson(child.acceptanceJson, module.acceptance)) {
    mismatches.push("acceptance");
  }
  if (!sameJson(child.nonGoalsJson, module.nonGoals)) {
    mismatches.push("nonGoals");
  }
  return mismatches;
}

function sameJson(stored: string, expected: unknown): boolean {
  return JSON.stringify(JSON.parse(stored)) === JSON.stringify(expected);
}

export function insertAcceptedRelations(
  database: TaskcraftDatabase,
  parentTaskId: string,
  revision: number,
  plan: L3PlanResult,
  children: MaterializedL3Child[],
): void {
  const childByModule = new Map(
    children.map((child) => [child.moduleKey, child.taskId]),
  );
  const insertCoverage = database.prepare(
    `INSERT INTO lifecycle_anchor_coverage (
       parent_task_id, parent_lifecycle_revision, anchor_id, child_task_id
     ) VALUES (?, ?, ?, ?)`,
  );
  for (const coverage of plan.coverage) {
    for (const moduleKey of coverage.moduleKeys) {
      insertCoverage.run(
        parentTaskId,
        revision,
        coverage.anchorId,
        childByModule.get(moduleKey)!,
      );
    }
  }

  const insertDependency = database.prepare(
    `INSERT INTO lifecycle_task_dependencies (
       parent_task_id, parent_lifecycle_revision, task_id, depends_on_task_id
     ) VALUES (?, ?, ?, ?)`,
  );
  for (const dependency of plan.dependencies) {
    insertDependency.run(
      parentTaskId,
      revision,
      childByModule.get(dependency.task)!,
      childByModule.get(dependency.dependsOn)!,
    );
  }

  insertValidations(database, parentTaskId, revision, plan, childByModule);
}

export function insertSingleValidations(
  database: TaskcraftDatabase,
  parentTaskId: string,
  revision: number,
  plan: L3PlanResult,
): void {
  insertValidations(database, parentTaskId, revision, plan, new Map());
}

function insertValidations(
  database: TaskcraftDatabase,
  parentTaskId: string,
  revision: number,
  plan: L3PlanResult,
  childByModule: Map<string, string>,
): void {
  const insert = database.prepare(
    `INSERT INTO lifecycle_validation_assignments (
       parent_task_id, parent_lifecycle_revision, validation_id, reference,
       owner_kind, owner_child_task_id
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const validation of plan.sharedValidations) {
    const parentOwned = validation.owner === "parent-integrate";
    insert.run(
      parentTaskId,
      revision,
      validation.id,
      validation.reference,
      parentOwned ? "parent_integrate" : "child",
      parentOwned ? null : childByModule.get(validation.owner),
    );
  }
}

export function invalidL3Plan(
  taskId: string,
  problems: string[],
): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_L3_PLAN_INVALID, {
    problem: `L3 plan cannot be accepted: ${problems.join("; ")}`,
    impact:
      "The review pass, execution revision and all child facts were rolled back",
    remediation: `Return to the parent Plan and correct it before retrying feasibility review for ${taskId}`,
    context: { taskId, problemCount: problems.length },
  });
}
