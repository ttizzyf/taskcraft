import { ERROR_CODES, TaskcraftError } from "./errors.js";
import type { Projection } from "./projector.js";
import type { TaskcraftDatabase } from "../store/database.js";
import {
  getEvidence,
  getLifecycle,
  getLifecycleSpecBindings,
  getAttempts,
  getReviewLinks,
} from "../store/query.js";
import { L1_EXECUTE_NODE_ID } from "./lifecycle/l1.js";
import type { NodeBrief } from "./reducer/context.js";

interface BriefSnapshot {
  title: string;
  revision: number;
  currentLifecycleRevision: number;
}

/** Builds the filesystem-free exact lifecycle snapshot delivered to a host.
 * The command boundary may attach current Registry drift after its check. */
export function buildNodeBrief(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: BriefSnapshot,
  claimedAttemptId: string,
  nodeId: string,
): NodeBrief {
  const graph = getLifecycle(
    database,
    taskId,
    snapshot.currentLifecycleRevision,
  );
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)!;
  const specs = getLifecycleSpecBindings(
    database,
    taskId,
    snapshot.currentLifecycleRevision,
    nodeId,
  ).map((binding) => ({
    id: binding.specId,
    kind: binding.specKind,
    duty: binding.duty,
    path: binding.specPath,
  }));
  const link =
    node.kind === "review"
      ? getReviewLinks(database, taskId).find(
          (item) => item.reviewAttemptId === claimedAttemptId,
        )
      : undefined;
  const reviewed =
    link === undefined
      ? undefined
      : getAttempts(database, taskId).find(
          (item) => item.id === link.reviewedAttemptId,
        );
  if (
    node.kind === "review" &&
    (link === undefined || reviewed === undefined)
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_STORE_PROJECTION_FAILED, {
      problem: `Review ${claimedAttemptId} has no valid reviewed attempt link`,
      impact: "The current Review Brief cannot be reconstructed",
      remediation: "Run tc doctor and repair the invalid Review facts",
      context: { taskId, attemptId: claimedAttemptId },
    });
  }
  const reviewedNode =
    reviewed === undefined
      ? undefined
      : graph.nodes.find((candidate) => candidate.id === reviewed.nodeId);

  return {
    taskId,
    taskTitle: snapshot.title,
    taskRevision: snapshot.revision,
    lifecycleRevision: snapshot.currentLifecycleRevision,
    nodeId: node.id,
    nodeKind: node.kind,
    attemptId: claimedAttemptId,
    objective: node.objective,
    procedureRef: node.procedureRef,
    obligations: graph.obligations
      .filter((obligation) => obligation.nodeId === nodeId)
      .map((obligation) => ({
        id: obligation.id,
        duty: obligation.duty,
        title: obligation.title,
      })),
    specs,
    reviewContext:
      reviewed === undefined || reviewedNode === undefined
        ? null
        : {
            purpose: link!.reviewPurpose,
            reviewedAttemptId: reviewed.id,
            reviewedNodeId: reviewed.nodeId,
            reviewedNodeKind: reviewedNode.kind,
            attemptNumber: reviewed.attemptNumber,
            outcome: reviewed.outcome!,
            result:
              reviewed.resultJson === null
                ? null
                : (JSON.parse(reviewed.resultJson) as unknown),
            evidence: getEvidence(database, taskId)
              .filter((evidence) => evidence.nodeAttemptId === reviewed.id)
              .map((evidence) => ({
                id: evidence.id,
                type: evidence.type,
                reference: evidence.reference,
                summary: evidence.summary,
                digest: evidence.digest,
              })),
          },
    resultSchemaJson: node.outputSchemaJson,
    nextCommand:
      nodeId === L1_EXECUTE_NODE_ID
        ? `tc run complete ${taskId}`
        : `tc run complete ${taskId} --node ${nodeId}`,
  };
}

/** Uses the projector's current-node selection, without claiming an attempt.
 * A modules parent can point to child work while having no local open node. */
export function getClaimedNodeBrief(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: BriefSnapshot,
  projection: Projection,
): NodeBrief | null {
  const node = projection.nodeStatuses.find(
    (item) => item.nodeId === projection.runningNode,
  );
  if (
    node?.attemptId == null ||
    projection.status === "done" ||
    projection.status === "cancelled"
  )
    return null;
  return buildNodeBrief(
    database,
    taskId,
    snapshot,
    node.attemptId,
    node.nodeId,
  );
}
