import type { TaskcraftDatabase } from "../../store/database.js";
import {
  getEvidence,
  getLifecycle,
  getLifecycleSpecBindings,
  type AttemptRow,
  type ReviewPurpose,
} from "../../store/query.js";
import { L1_EXECUTE_NODE_ID } from "../lifecycle/l1.js";
import type { NodeBrief } from "./context.js";

interface BriefSnapshot {
  title: string;
  revision: number;
  currentLifecycleRevision: number;
}

interface ReviewedAttemptContext {
  attempt: AttemptRow;
  purpose: ReviewPurpose;
}

/** Builds the filesystem-free exact lifecycle snapshot delivered to a host.
 * The command boundary may attach current Registry drift after its check. */
export function buildNodeBrief(
  database: TaskcraftDatabase,
  taskId: string,
  snapshot: BriefSnapshot,
  claimedAttemptId: string,
  nodeId: string,
  reviewed?: ReviewedAttemptContext,
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
    digest: binding.specDigest,
    drift: null,
  }));
  const reviewedNode =
    reviewed === undefined
      ? undefined
      : graph.nodes.find(
          (candidate) => candidate.id === reviewed.attempt.nodeId,
        );

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
            purpose: reviewed.purpose,
            reviewedAttemptId: reviewed.attempt.id,
            reviewedNodeId: reviewed.attempt.nodeId,
            reviewedNodeKind: reviewedNode.kind,
            attemptNumber: reviewed.attempt.attemptNumber,
            outcome: reviewed.attempt.outcome!,
            result:
              reviewed.attempt.resultJson === null
                ? null
                : (JSON.parse(reviewed.attempt.resultJson) as unknown),
            evidence: getEvidence(database, taskId)
              .filter(
                (evidence) => evidence.nodeAttemptId === reviewed.attempt.id,
              )
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
