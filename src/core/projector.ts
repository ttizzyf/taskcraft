// Single projector: derives the five public statuses, runnable/running
// nodes, waiting reason, obligation completion and the unique next command
// from the query model snapshot. It never writes to the database and never
// reads agent_runs: observations cannot drive task completion.

import { ERROR_CODES, TaskcraftError } from "./errors.js";
import { buildBreadcrumb } from "./breadcrumb.js";
import type { BreadcrumbV1 } from "./breadcrumb.js";
import type { BlockerWaitingReason, NodeKind } from "../store/query.js";
import type { TaskcraftDatabase } from "../store/database.js";
import {
  getAttempts,
  getLifecycle,
  getObligationResults,
  getOpenBlockers,
  getTask,
} from "../store/query.js";
import { L1_EXECUTE_NODE_ID, L1_RECORD_NODE_ID } from "./lifecycle/l1.js";

export type ProjectStatus =
  "queued" | "active" | "waiting" | "done" | "cancelled";

export type NodeProjectionStatus =
  "satisfied" | "running" | "runnable" | "blocked";

export interface NodeProjection {
  nodeId: string;
  kind: NodeKind;
  status: NodeProjectionStatus;
  attemptId: string | null;
}

export interface Projection {
  status: ProjectStatus;
  waitingReason: BlockerWaitingReason | null;
  nodeStatuses: NodeProjection[];
  runnableNodes: string[];
  runningNode: string | null;
  doneObligations: number;
  totalObligations: number;
  next: string | null;
  breadcrumb: BreadcrumbV1;
}

export function project(
  database: TaskcraftDatabase,
  taskId: string,
): Projection {
  const snapshot = getTask(database, taskId);

  if (snapshot === null) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_NOT_FOUND, {
      problem: `Task ${taskId} does not exist`,
      impact: "The task cannot be projected because it is unknown",
      remediation: "List known tasks with: tc task list",
      context: { taskId },
    });
  }

  const revision = snapshot.currentLifecycleRevision;
  const graph = getLifecycle(database, taskId, revision);
  const attempts = getAttempts(database, taskId).filter(
    (attempt) => attempt.lifecycleRevision === revision,
  );
  const obligationResults = getObligationResults(database, taskId).filter(
    (result) => result.lifecycleRevision === revision,
  );
  const blockers = getOpenBlockers(database, taskId);

  const requiredObligations = graph.obligations.filter(
    (obligation) => obligation.duty === "required",
  );
  const satisfiedObligationIds = new Set(
    obligationResults
      .filter((result) => result.status === "satisfied")
      .map((result) => result.obligationId),
  );
  const satisfiedRequired = requiredObligations.filter((obligation) =>
    satisfiedObligationIds.has(obligation.id),
  );

  const isNodeSatisfied = (nodeId: string): boolean =>
    attempts.some(
      (attempt) =>
        attempt.nodeId === nodeId &&
        attempt.status === "finished" &&
        attempt.outcome === "success",
    );

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

    let status: NodeProjectionStatus = "blocked";
    if (isNodeSatisfied(node.id)) {
      status = "satisfied";
    } else if (runningAttempt !== undefined) {
      status = "running";
    } else if (
      !blockedByBlocker &&
      predecessors.every((id) => isNodeSatisfied(id))
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

  if (snapshot.cancelledAt !== null) {
    status = "cancelled";
    next = `tc task show ${taskId}`;
  } else if (snapshot.activatedAt === null) {
    status = "queued";
    next = `tc run ${taskId}`;
  } else if (recordObligationSatisfied && allRequiredSatisfied) {
    status = "done";
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
      next =
        runningNode === L1_EXECUTE_NODE_ID
          ? `tc run complete ${taskId}`
          : `tc run complete ${taskId} --node ${runningNode}`;
    } else if (runnableNodes.length > 0) {
      next = `tc run ${taskId} --node ${runnableNodes[0]!}`;
    } else {
      next = null;
    }
  }

  const nodeForAnchor =
    nodeStates.find((node) => node.nodeId === runningNode) ??
    nodeStates.find((node) => node.nodeId === runnableNodes[0]);

  return {
    status,
    waitingReason,
    nodeStatuses: nodeStates,
    runnableNodes,
    runningNode,
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
      blocked: blockers.map((blocker) => blocker.waitingReason),
    }),
  };
}
