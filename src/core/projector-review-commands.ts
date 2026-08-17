import type {
  AttemptRow,
  EdgeRow,
  NodeKind,
  ReviewLinkRow,
  ReviewPurpose,
} from "../store/query.js";
import type { NodeProjection } from "./projector.js";

export const REVIEW_PURPOSE_BY_KIND: Readonly<Record<string, ReviewPurpose>> = {
  plan: "feasibility",
  execute: "delivery",
  integrate: "integration",
};

export function reviewPassCommand(
  taskId: string,
  node: NodeProjection,
  attempts: AttemptRow[],
  links: ReviewLinkRow[],
): string {
  const reviewAttempt = attempts.find(
    (attempt) =>
      attempt.nodeId === node.nodeId &&
      (attempt.status === "created" || attempt.status === "running"),
  );
  const link = links.find(
    (candidate) => candidate.reviewAttemptId === reviewAttempt?.id,
  );
  if (reviewAttempt === undefined || link === undefined) {
    return `tc task show ${taskId}`;
  }
  return `tc review pass ${taskId} --attempt ${reviewAttempt.id} --reviewed-attempt ${link.reviewedAttemptId}`;
}

export function reviewStartCommand(
  taskId: string,
  node: NodeProjection,
  attempts: AttemptRow[],
  edges: EdgeRow[],
  nodeKindById: Map<string, NodeKind>,
): string {
  const reviewedNodeId = edges.find(
    (edge) => edge.toNodeId === node.nodeId,
  )?.fromNodeId;
  const reviewedAttempt = [...attempts]
    .filter(
      (attempt) =>
        attempt.nodeId === reviewedNodeId &&
        attempt.status === "finished" &&
        attempt.outcome === "success",
    )
    .at(-1);
  if (reviewedAttempt === undefined) return `tc task show ${taskId}`;
  const purpose =
    REVIEW_PURPOSE_BY_KIND[nodeKindById.get(reviewedNodeId ?? "") ?? ""] ??
    "delivery";
  return `tc review start ${taskId} --node ${node.nodeId} --purpose ${purpose} --reviewed-attempt ${reviewedAttempt.id}`;
}
