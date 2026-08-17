import type { TaskcraftDatabase } from "../store/database.js";
import { getTask, getTaskRelations } from "../store/query.js";
import type { ChildRequirementRow, TaskRelations } from "../store/query.js";
import type { TaskSnapshot } from "../store/revision-guard.js";
import { ERROR_CODES, TaskcraftError } from "./errors.js";
import type {
  ChildProjection,
  NodeProjection,
  ProjectStatus,
  Projection,
  RunnableWorkItem,
} from "./projector-types.js";

export interface RequiredChildDetail {
  requirement: ChildRequirementRow;
  snapshot: TaskSnapshot;
  projection: Projection;
}

/** Resolves the current accepted parent contract for a child. Historical or
 * not-required children have no parent dependency gate. Required children
 * are blocked until every explicit predecessor is done. */
export function projectUnsatisfiedParentDependencies(
  database: TaskcraftDatabase,
  snapshot: TaskSnapshot,
  ancestors: Set<string>,
  projectDependency: (
    dependencyTaskId: string,
    ancestors: Set<string>,
  ) => Projection,
): string[] {
  if (snapshot.parentTaskId === null) return [];

  const parent = getTask(database, snapshot.parentTaskId);
  if (parent === null) {
    throw new TaskcraftError(ERROR_CODES.TC_STORE_PROJECTION_FAILED, {
      problem: `Child ${snapshot.id} references missing parent ${snapshot.parentTaskId}`,
      impact: "The child dependency gate cannot be derived safely",
      remediation: "Run tc doctor and repair the invalid task hierarchy",
      context: { taskId: snapshot.id, parentTaskId: snapshot.parentTaskId },
    });
  }

  const relations = getTaskRelations(
    database,
    parent.id,
    parent.currentLifecycleRevision,
  );
  const currentRequired = relations.children.some(
    (child) =>
      child.childTaskId === snapshot.id &&
      child.requirementStatus === "required",
  );
  if (!currentRequired) return [];

  return relations.dependencies
    .filter((dependency) => dependency.taskId === snapshot.id)
    .filter(
      (dependency) =>
        projectDependency(dependency.dependsOnTaskId, ancestors).status !==
        "done",
    )
    .map((dependency) => dependency.dependsOnTaskId);
}

interface ChildAggregation {
  children: ChildProjection[];
  requiredChildren: RequiredChildDetail[];
  modulesMode: boolean;
  childWorkItems: RunnableWorkItem[];
  allRequiredChildrenDone: boolean;
}

export function projectOwnWorkItems(input: {
  taskId: string;
  parentTaskId: string | null;
  status: ProjectStatus;
  next: string | null;
  childWorkItems: RunnableWorkItem[];
  nodeForAnchor: NodeProjection | undefined;
}): RunnableWorkItem[] {
  if (
    (input.status !== "queued" && input.status !== "active") ||
    input.next === null ||
    input.childWorkItems.length > 0
  ) {
    return [];
  }
  return [
    {
      taskId: input.taskId,
      parentTaskId: input.parentTaskId,
      nodeId: input.nodeForAnchor?.nodeId ?? null,
      command: input.next,
      reason: "task lifecycle node is runnable",
    },
  ];
}

export function projectChildWork(
  database: TaskcraftDatabase,
  taskId: string,
  revision: number,
  relations: TaskRelations,
  ancestors: Set<string>,
  projectChild: (childTaskId: string, ancestors: Set<string>) => Projection,
): ChildAggregation {
  const childDetails = relations.children.map((requirement) => {
    const childSnapshot = getTask(database, requirement.childTaskId);
    if (childSnapshot === null || childSnapshot.level === 3) {
      throw new TaskcraftError(ERROR_CODES.TC_STORE_PROJECTION_FAILED, {
        problem: `L3 relation references invalid child ${requirement.childTaskId}`,
        impact: "The parent projection cannot derive its completion gate",
        remediation: "Run tc doctor and repair the invalid child relation",
        context: { taskId, childTaskId: requirement.childTaskId },
      });
    }
    return {
      requirement,
      snapshot: childSnapshot,
      projection: projectChild(childSnapshot.id, ancestors),
    };
  });
  const children: ChildProjection[] = childDetails.map(
    ({ requirement, snapshot, projection }) => ({
      moduleKey: requirement.moduleKey,
      taskId: snapshot.id,
      title: snapshot.title,
      level: snapshot.level as 1 | 2,
      requirementStatus: requirement.requirementStatus,
      orderIndex: requirement.orderIndex,
      status: projection.status,
      waitingReason: projection.waitingReason,
      taskRevision: snapshot.revision,
      doneObligations: projection.doneObligations,
      totalObligations: projection.totalObligations,
      next: projection.next,
    }),
  );
  const requiredChildren = childDetails.filter(
    ({ requirement }) => requirement.requirementStatus === "required",
  );
  const modulesMode = relations.executionSource?.mode === "modules";
  if (modulesMode && requiredChildren.length === 0) {
    throw new TaskcraftError(ERROR_CODES.TC_STORE_PROJECTION_FAILED, {
      problem: `Modules execution revision ${revision} has no required children`,
      impact: "Integrate cannot be gated safely",
      remediation: "Run tc doctor and restore the accepted child requirements",
      context: { taskId, lifecycleRevision: revision },
    });
  }

  const childWorkItems: RunnableWorkItem[] = requiredChildren.flatMap(
    ({ snapshot, projection }) =>
      (projection.status === "queued" || projection.status === "active") &&
      projection.next !== null
        ? [
            {
              taskId: snapshot.id,
              parentTaskId: taskId,
              nodeId:
                projection.nodeStatuses.find(
                  (node) =>
                    node.status === "running" || node.status === "runnable",
                )?.nodeId ?? null,
              command: projection.next,
              reason:
                "child lifecycle is runnable and explicit dependencies are done",
            },
          ]
        : [],
  );
  const allRequiredChildrenDone =
    requiredChildren.length > 0 &&
    requiredChildren.every(({ projection }) => projection.status === "done");

  return {
    children,
    requiredChildren,
    modulesMode,
    childWorkItems,
    allRequiredChildrenDone,
  };
}
