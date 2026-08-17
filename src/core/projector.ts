// Single projector for task lifecycle and one-level L3 child aggregation. It
// reads normalized facts only, never agent_runs, and never schedules hosts.

import { buildBreadcrumb } from "./breadcrumb.js";
import { ERROR_CODES, TaskcraftError } from "./errors.js";
import { L1_EXECUTE_NODE_ID, L1_RECORD_NODE_ID } from "./lifecycle/l1.js";
import { L2_FRAME_NODE_ID } from "./lifecycle/l2.js";
import {
  L3_INTEGRATE_NODE_ID,
  L3_REVIEW_INTEGRATE_NODE_ID,
} from "./lifecycle/l3.js";
import type { TaskcraftDatabase } from "../store/database.js";
import type { BlockerWaitingReason } from "../store/query.js";
import {
  getAttempts,
  getInheritedPlanning,
  getLifecycle,
  getObligationResults,
  getOpenBlockers,
  getReviewLinks,
  getTask,
  getTaskRelations,
} from "../store/query.js";
import {
  projectChildWork,
  projectOwnWorkItems,
  projectUnsatisfiedParentDependencies,
} from "./projector-children.js";
import {
  REVIEW_PURPOSE_BY_KIND,
  reviewPassCommand,
  reviewStartCommand,
} from "./projector-review-commands.js";
import type {
  NodeProjectionStatus,
  ProjectStatus,
  Projection,
} from "./projector-types.js";
export type {
  ChildProjection,
  NodeProjection,
  NodeProjectionStatus,
  ProjectStatus,
  Projection,
  RunnableWorkItem,
} from "./projector-types.js";

export function project(
  database: TaskcraftDatabase,
  taskId: string,
): Projection {
  return projectTask(database, taskId, new Set(), new Map());
}

function projectTask(
  database: TaskcraftDatabase,
  taskId: string,
  ancestors: Set<string>,
  cache: Map<string, Projection>,
): Projection {
  if (ancestors.has(taskId)) {
    throw new TaskcraftError(ERROR_CODES.TC_STORE_PROJECTION_FAILED, {
      problem: `Task hierarchy cycle reached ${taskId}`,
      impact: "The task projection cannot choose runnable work safely",
      remediation: "Run tc doctor and repair the invalid parent/child facts",
      context: { taskId },
    });
  }
  const cached = cache.get(taskId);
  if (cached !== undefined) return cached;

  const snapshot = getTask(database, taskId);
  if (snapshot === null) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_NOT_FOUND, {
      problem: `Task ${taskId} does not exist`,
      impact: "The task cannot be projected because it is unknown",
      remediation: "List known tasks with: tc task list",
      context: { taskId },
    });
  }

  const nextAncestors = new Set(ancestors).add(taskId);
  const revision = snapshot.currentLifecycleRevision;
  const graph = getLifecycle(database, taskId, revision);
  const attempts = getAttempts(database, taskId).filter(
    (attempt) => attempt.lifecycleRevision === revision,
  );
  const obligationResults = getObligationResults(database, taskId).filter(
    (result) => result.lifecycleRevision === revision,
  );
  const blockers = getOpenBlockers(database, taskId);
  const reviewLinks = getReviewLinks(database, taskId);
  const relations = getTaskRelations(database, taskId, revision);
  const inheritedPlanning = getInheritedPlanning(database, taskId, revision);
  const unsatisfiedParentDependencies = projectUnsatisfiedParentDependencies(
    database,
    snapshot,
    nextAncestors,
    (dependencyTaskId, dependencyAncestors) =>
      projectTask(database, dependencyTaskId, dependencyAncestors, cache),
  );

  const {
    children,
    requiredChildren,
    modulesMode,
    childWorkItems,
    allRequiredChildrenDone,
  } = projectChildWork(
    database,
    taskId,
    revision,
    relations,
    nextAncestors,
    (childTaskId, ancestors) =>
      projectTask(database, childTaskId, ancestors, cache),
  );

  const requiredObligations = graph.obligations.filter(
    (obligation) => obligation.duty === "required",
  );
  const satisfiedObligationIds = new Set(
    obligationResults
      .filter((result) => result.status === "satisfied")
      .map((result) => result.obligationId),
  );
  const nodeKindById = new Map(graph.nodes.map((node) => [node.id, node.kind]));

  const isNodeSatisfied = (nodeId: string): boolean =>
    attempts.some((attempt) => {
      if (attempt.nodeId !== nodeId || attempt.status !== "finished")
        return false;
      const kind = nodeKindById.get(nodeId);
      if (kind !== "review") return attempt.outcome === "success";
      if (attempt.outcome !== "passed") return false;
      const link = reviewLinks.find(
        (candidate) => candidate.reviewAttemptId === attempt.id,
      );
      if (link === undefined) return false;
      const reviewed = attempts.find(
        (candidate) => candidate.id === link.reviewedAttemptId,
      );
      if (reviewed === undefined) return false;
      const reviewedKind = nodeKindById.get(reviewed.nodeId);
      if (link.reviewPurpose !== REVIEW_PURPOSE_BY_KIND[reviewedKind ?? ""])
        return false;
      const latestFinished = attempts
        .filter(
          (candidate) =>
            candidate.nodeId === reviewed.nodeId &&
            candidate.status === "finished",
        )
        .at(-1);
      return reviewed.id === latestFinished?.id;
    });

  const latestIntegrateAttempt = [...attempts]
    .filter(
      (attempt) =>
        attempt.nodeId === L3_INTEGRATE_NODE_ID &&
        attempt.status === "finished" &&
        attempt.outcome === "success",
    )
    .at(-1);
  const modifiedDeliverables =
    latestIntegrateAttempt?.resultJson === null ||
    latestIntegrateAttempt === undefined
      ? false
      : (
          JSON.parse(latestIntegrateAttempt.resultJson) as {
            modifiedDeliverables?: unknown;
          }
        ).modifiedDeliverables === true;
  const integrationReviewBypassed =
    latestIntegrateAttempt !== undefined && !modifiedDeliverables;
  if (integrationReviewBypassed) {
    for (const obligation of graph.obligations) {
      if (obligation.nodeId === L3_REVIEW_INTEGRATE_NODE_ID) {
        satisfiedObligationIds.add(obligation.id);
      }
    }
  }

  const nodeStates = graph.nodes.map((node) => {
    const nodeAttempts = attempts.filter(
      (attempt) => attempt.nodeId === node.id,
    );
    const runningAttempt = nodeAttempts.find(
      (attempt) => attempt.status === "created" || attempt.status === "running",
    );
    const predecessors = graph.edges
      .filter((edge) => edge.toNodeId === node.id)
      .map((edge) => edge.fromNodeId);
    const blockedByBlocker = blockers.some(
      (blocker) => blocker.nodeId === node.id,
    );
    const blockedByChildren =
      modulesMode &&
      node.id === L3_INTEGRATE_NODE_ID &&
      !allRequiredChildrenDone;
    const blockedByParentDependency = unsatisfiedParentDependencies.length > 0;
    const predecessorSatisfied = (nodeId: string): boolean =>
      (integrationReviewBypassed && nodeId === L3_REVIEW_INTEGRATE_NODE_ID) ||
      isNodeSatisfied(nodeId);

    let status: NodeProjectionStatus = "blocked";
    if (runningAttempt !== undefined) {
      status = "running";
    } else if (isNodeSatisfied(node.id)) {
      status = "satisfied";
    } else if (
      !blockedByBlocker &&
      !blockedByChildren &&
      !blockedByParentDependency &&
      predecessors.every(predecessorSatisfied) &&
      !(integrationReviewBypassed && node.id === L3_REVIEW_INTEGRATE_NODE_ID)
    ) {
      status = "runnable";
    }
    return {
      nodeId: node.id,
      kind: node.kind,
      status,
      attemptId: runningAttempt?.id ?? null,
    };
  });

  const runnableNodes = nodeStates
    .filter((node) => node.status === "runnable")
    .map((node) => node.nodeId);
  const runningNode =
    nodeStates.find((node) => node.status === "running")?.nodeId ?? null;
  const satisfiedRequired = requiredObligations.filter((obligation) =>
    satisfiedObligationIds.has(obligation.id),
  );
  const recordObligationSatisfied = graph.obligations.some(
    (obligation) =>
      obligation.nodeId === L1_RECORD_NODE_ID &&
      satisfiedObligationIds.has(obligation.id),
  );
  const allRequiredSatisfied =
    requiredObligations.length > 0 &&
    satisfiedRequired.length === requiredObligations.length;

  let status: ProjectStatus;
  let waitingReason: BlockerWaitingReason | null = null;
  let next: string | null = null;
  const cancelledRequiredChild = requiredChildren.find(
    ({ projection }) => projection.status === "cancelled",
  );

  if (snapshot.cancelledAt !== null) {
    status = "cancelled";
    next = `tc task show ${taskId}`;
  } else if (unsatisfiedParentDependencies.length > 0 && runningNode === null) {
    status = snapshot.activatedAt === null ? "queued" : "waiting";
    waitingReason = snapshot.activatedAt === null ? null : "blocked_dependency";
    next = null;
  } else if (snapshot.activatedAt === null) {
    status = "queued";
    next = graph.nodes.some((node) => node.kind === "frame")
      ? `tc run ${taskId} --node ${L2_FRAME_NODE_ID}`
      : `tc run ${taskId}`;
  } else if (recordObligationSatisfied && allRequiredSatisfied) {
    status = "done";
  } else if (modulesMode && cancelledRequiredChild !== undefined) {
    status = "waiting";
    waitingReason = "needs_decision";
    next = `tc task show ${taskId}`;
  } else if (modulesMode && childWorkItems.length > 0) {
    status = "active";
    next = childWorkItems[0]!.command;
  } else if (modulesMode && !allRequiredChildrenDone) {
    status = "waiting";
    const waitingChild = requiredChildren.find(
      ({ projection }) => projection.status === "waiting",
    );
    waitingReason = waitingChild?.projection.waitingReason ?? "needs_decision";
    next = waitingChild?.projection.next ?? `tc task show ${taskId}`;
  } else if (
    blockers.length > 0 &&
    runnableNodes.length === 0 &&
    runningNode === null
  ) {
    status = "waiting";
    waitingReason = blockers[0]!.waitingReason;
    next = blockers[0]!.remediationCommand;
  } else {
    status = "active";
    if (runningNode !== null) {
      const runningState = nodeStates.find(
        (node) => node.nodeId === runningNode,
      );
      next =
        runningState?.kind === "review"
          ? reviewPassCommand(taskId, runningState, attempts, reviewLinks)
          : runningNode === L1_EXECUTE_NODE_ID
            ? `tc run complete ${taskId}`
            : `tc run complete ${taskId} --node ${runningNode}`;
    } else if (runnableNodes.length > 0) {
      const runnableState = nodeStates.find(
        (node) => node.nodeId === runnableNodes[0],
      );
      next =
        runnableState?.kind === "review"
          ? reviewStartCommand(
              taskId,
              runnableState,
              attempts,
              graph.edges,
              nodeKindById,
            )
          : `tc run ${taskId} --node ${runnableNodes[0]!}`;
    }
  }

  const nodeForAnchor =
    nodeStates.find((node) => node.nodeId === runningNode) ??
    nodeStates.find((node) => node.nodeId === runnableNodes[0]);
  const ownWorkItems = projectOwnWorkItems({
    taskId,
    parentTaskId: snapshot.parentTaskId,
    status,
    next,
    childWorkItems,
    nodeForAnchor,
  });
  const propagatedBlocked = requiredChildren.flatMap(({ projection }) =>
    projection.waitingReason === null ? [] : [projection.waitingReason],
  );

  const projection: Projection = {
    status,
    waitingReason,
    nodeStatuses: nodeStates,
    runnableNodes,
    runningNode,
    runnableWorkItems:
      childWorkItems.length > 0 ? childWorkItems : ownWorkItems,
    children,
    anchors: relations.anchors,
    coverage: relations.coverage,
    dependencies: relations.dependencies,
    validations: relations.validations,
    executionSource: relations.executionSource,
    inheritedPlanning,
    doneObligations: satisfiedRequired.length,
    totalObligations: requiredObligations.length,
    next,
    breadcrumb: buildBreadcrumb({
      task: {
        id: taskId,
        level: snapshot.level,
        status,
        taskRevision: snapshot.revision,
        lifecycleRevision: snapshot.currentLifecycleRevision,
        waitingReason,
        node: nodeForAnchor?.nodeId ?? null,
        nodeKind: nodeForAnchor?.kind ?? null,
      },
      nextCommand: next,
      blocked: [
        ...blockers.map((blocker) => blocker.waitingReason),
        ...propagatedBlocked,
        ...(unsatisfiedParentDependencies.length > 0
          ? (["blocked_dependency"] as const)
          : []),
      ],
    }),
  };
  cache.set(taskId, projection);
  return projection;
}
