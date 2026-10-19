import { withNodeBriefSpecDrift } from "../core/node-brief-query.js";
import type { TaskcraftDatabase } from "../store/database.js";
import {
  getAttempts,
  getLifecycle,
  getLifecycleSpecBindings,
  getTask,
} from "../store/query.js";
import { checkRevision } from "../store/revision-guard.js";
import type { TaskSnapshot } from "../store/revision-guard.js";
import {
  evaluateSpecBindingDrift,
  loadSpecRegistry,
  staleRequiredBindingsError,
  type SpecBindingDrift,
} from "../spec/index.js";
import { TaskcraftError } from "../core/errors.js";
import type { NodeBrief } from "../core/reducer.js";

export interface AttemptSpecBindingCheck {
  drift: SpecBindingDrift[];
  taskRevision?: number;
}

/** Filesystem-aware command boundary. Reducers receive no project path and do
 * not read the Registry. Empty/legacy revisions remain valid without IO. */
export function assertRunAttemptSpecBindings(
  database: TaskcraftDatabase,
  taskId: string,
  nodeId: string,
  expectedRevision?: number,
): AttemptSpecBindingCheck {
  const snapshot = resolveBoundarySnapshot(database, taskId, expectedRevision);
  if (snapshot === null) return { drift: [] };
  const creatingAttempt = !getAttempts(database, taskId).some(
    (attempt) =>
      attempt.lifecycleRevision === snapshot.currentLifecycleRevision &&
      attempt.nodeId === nodeId &&
      (attempt.status === "created" || attempt.status === "running"),
  );
  return checkCurrentAttemptSpecBindings(
    database,
    snapshot,
    nodeId,
    creatingAttempt,
  );
}

export function assertReviewAttemptSpecBindings(
  database: TaskcraftDatabase,
  taskId: string,
  nodeId: string,
  expectedRevision?: number,
): AttemptSpecBindingCheck {
  return assertNewAttemptSpecBindings(
    database,
    taskId,
    nodeId,
    expectedRevision,
  );
}

/** Successor paths such as retry and review changes always create an Attempt,
 * so they must not reuse the active-attempt shortcut used by `tc run`. */
export function assertNewAttemptSpecBindings(
  database: TaskcraftDatabase,
  taskId: string,
  nodeId: string,
  expectedRevision?: number,
): AttemptSpecBindingCheck {
  const snapshot = resolveBoundarySnapshot(database, taskId, expectedRevision);
  if (snapshot === null) return { drift: [] };
  return checkCurrentAttemptSpecBindings(database, snapshot, nodeId, true);
}

function checkCurrentAttemptSpecBindings(
  database: TaskcraftDatabase,
  snapshot: TaskSnapshot,
  nodeId: string,
  creatingAttempt: boolean,
): AttemptSpecBindingCheck {
  const result = (drift: SpecBindingDrift[]): AttemptSpecBindingCheck => ({
    drift,
    taskRevision: snapshot.revision,
  });
  const node = getLifecycle(
    database,
    snapshot.id,
    snapshot.currentLifecycleRevision,
  ).nodes.find((candidate) => candidate.id === nodeId);
  if (node?.kind !== "execute" && node?.kind !== "review") return result([]);
  const bindings = getLifecycleSpecBindings(
    database,
    snapshot.id,
    snapshot.currentLifecycleRevision,
    nodeId,
  );
  if (bindings.length === 0) return result([]);
  let drift: SpecBindingDrift[];
  try {
    drift = evaluateSpecBindingDrift(loadSpecRegistry(process.cwd()), bindings);
  } catch (error) {
    if (!(error instanceof TaskcraftError)) throw error;
    drift = bindings.map((binding) => ({
      binding,
      status: "stale" as const,
      reasons: ["registry_unavailable" as const],
    }));
  }
  // Only a new Execute attempt is blocked. Starting a Review is how a stale
  // contract gets adjudicated, so it must stay reachable: blocking it would
  // deadlock the very work that maintains the Specs, since the task that edits
  // its own required Specs is exactly the one that turns them stale.
  if (
    creatingAttempt &&
    node.kind === "execute" &&
    drift.some(
      (item) => item.status === "stale" && item.binding.duty === "required",
    )
  ) {
    throw staleRequiredBindingsError(snapshot.id, drift);
  }
  return result(drift);
}

/** Attaches the command boundary's Registry comparison to the immutable
 * snapshot already present in the reducer-built Node Brief. */
export function attachNodeBriefSpecDrift(
  brief: NodeBrief,
  drift: readonly SpecBindingDrift[],
): NodeBrief {
  return withNodeBriefSpecDrift(
    brief,
    drift.map((item) => ({
      id: item.binding.specId,
      drift: { status: item.status, reasons: [...item.reasons] },
    })),
  );
}

function resolveBoundarySnapshot(
  database: TaskcraftDatabase,
  taskId: string,
  expectedRevision: number | undefined,
): TaskSnapshot | null {
  return expectedRevision === undefined
    ? getTask(database, taskId)
    : checkRevision(database, taskId, expectedRevision);
}
