import {
  assertResolvedBindings,
  assertResolvedSpecSelections,
  selectionsFromBindingRows,
  type SpecSelection,
} from "../../spec/bindings.js";
import type { TaskcraftDatabase } from "../../store/database.js";
import { insertLifecycleSpecBindings } from "../../store/spec-facts.js";
import {
  getLifecycleSpecBindings,
  getTask,
  getTaskRelations,
} from "../../store/query.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import type { TaskSpecRefreshData, TaskSpecRefreshInput } from "./context.js";
import {
  assertNotCancelled,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import { recordReplacedChildren } from "./l3-replan.js";
import { materializePlanningRevision } from "./revision-materialize.js";
import { bumpRevision, insertEvent, nowIso } from "./shared.js";

export function taskSpecRefresh(
  database: TaskcraftDatabase,
  taskId: string,
  input: TaskSpecRefreshInput,
): TaskSpecRefreshData {
  return withTransaction(database, () => {
    const requested = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(requested);
    if (input.reason.trim() === "") {
      throw new TaskcraftError(ERROR_CODES.TC_SPEC_BINDING_INVALID, {
        problem: "Spec refresh requires a non-empty reason",
        impact: "No lifecycle revision or binding facts were written",
        remediation: `Retry with: tc task spec refresh ${taskId} --reason <reason>`,
        context: { taskId },
      });
    }
    assertResolvedBindings(
      input.resolvedSpecBindings,
      "Refreshed Spec bindings",
    );

    const root =
      requested.parentTaskId === null
        ? requested
        : resolveRefreshRoot(database, requested);
    assertNotCancelled(root);
    assertResolvedSpecSelections(
      refreshSelectionsForRoot(database, root),
      input.resolvedSpecBindings,
      "Refreshed Spec bindings",
    );
    const oldRevision = root.currentLifecycleRevision;
    const newRevision = oldRevision + 1;
    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const now = nowIso();
    materializePlanningRevision(database, {
      snapshot: root,
      newRevision,
      reasonCode: "manual_revision",
      reason: input.reason,
      changeSummary: {
        oldRevision,
        newRevision,
        reasonCode: "spec_refresh",
        requestedTaskId: requested.id,
      },
      actor,
      now,
    });

    if (root.level === 3) {
      recordReplacedChildren(
        database,
        root.id,
        oldRevision,
        newRevision,
        root.revision + 1,
        actor,
        now,
      );
    }
    insertLifecycleSpecBindings(database, {
      taskId: root.id,
      lifecycleRevision: newRevision,
      nodeIds:
        root.level === 1
          ? ["execute-1", "record-1"]
          : root.level === 2
            ? ["frame-1"]
            : ["frame-1", "plan-1", "review-plan-1"],
      bindings: input.resolvedSpecBindings,
      source: { kind: "refresh" },
      actor,
      now,
    });
    database
      .prepare(
        `UPDATE tasks SET current_lifecycle_revision = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(newRevision, now, root.id);

    if (requested.id !== root.id) {
      insertEvent(database, {
        taskId: requested.id,
        lifecycleRevision: requested.currentLifecycleRevision,
        nodeId: null,
        attemptId: null,
        eventType: "task.spec_refresh_routed",
        payload: {
          parentTaskId: root.id,
          parentOldRevision: oldRevision,
          parentNewRevision: newRevision,
          reason: input.reason,
        },
        postTaskRevision: requested.revision + 1,
        actorInstanceId: actor,
        host: null,
        occurredAt: now,
      });
      bumpRevision(database, requested, now);
    }
    insertEvent(database, {
      taskId: root.id,
      lifecycleRevision: newRevision,
      nodeId: null,
      attemptId: null,
      eventType: "task.spec_refreshed",
      payload: {
        requestedTaskId: requested.id,
        oldRevision,
        newRevision,
        reason: input.reason,
        specIds: input.resolvedSpecBindings.map((binding) => binding.specId),
      },
      postTaskRevision: root.revision + 1,
      actorInstanceId: actor,
      host: null,
      occurredAt: now,
    });
    bumpRevision(database, root, now);

    return {
      ...commandData(database, root.id, snapshotOf(database, root.id)),
      requestedTaskId: requested.id,
      refreshedTaskId: root.id,
      newRevision,
    };
  });
}

/** One query owner for the id/duty set carried into a refresh revision. The
 * command resolves this set from the Registry; the reducer recomputes it in
 * its transaction before accepting the resolved snapshots. */
export function getTaskSpecRefreshSelections(
  database: TaskcraftDatabase,
  taskId: string,
): SpecSelection[] {
  const requested = getTask(database, taskId);
  if (requested === null) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_NOT_FOUND, {
      problem: `Task ${taskId} does not exist`,
      impact: "No Spec binding or lifecycle facts were written",
      remediation: "List known tasks with: tc task list",
      context: { taskId },
    });
  }
  if (requested.parentTaskId === null) {
    return refreshSelectionsForRoot(database, requested);
  }
  const parent = getTask(database, requested.parentTaskId);
  if (parent === null) {
    throw new TaskcraftError(ERROR_CODES.TC_SPEC_BINDING_INVALID, {
      problem: `Task ${taskId} references a missing parent ${requested.parentTaskId}`,
      impact: "No Spec binding or lifecycle facts were written",
      remediation:
        "Run tc doctor and repair the task hierarchy before retrying",
      context: { taskId, parentTaskId: requested.parentTaskId },
    });
  }
  return refreshSelectionsForRoot(database, parent);
}

function refreshSelectionsForRoot(
  database: TaskcraftDatabase,
  root: TaskSnapshot,
): SpecSelection[] {
  const revision = root.currentLifecycleRevision;
  if (root.level === 3) {
    const planningRevision =
      getTaskRelations(database, root.id, revision).executionSource
        ?.planningRevision ?? revision;
    return selectionsFromBindingRows(
      getLifecycleSpecBindings(database, root.id, planningRevision),
    );
  }
  const executionBindings = getLifecycleSpecBindings(
    database,
    root.id,
    revision,
    "execute-1",
  );
  return selectionsFromBindingRows(
    executionBindings.length > 0
      ? executionBindings
      : getLifecycleSpecBindings(
          database,
          root.id,
          revision,
          root.level === 1 ? "record-1" : "frame-1",
        ),
  );
}

function resolveRefreshRoot(
  database: TaskcraftDatabase,
  child: ReturnType<typeof snapshotOf>,
): ReturnType<typeof snapshotOf> {
  const parent = resolveSnapshot(database, child.parentTaskId!, undefined);
  const relations = getTaskRelations(
    database,
    parent.id,
    parent.currentLifecycleRevision,
  );
  const currentRequired = relations.children.some(
    (candidate) =>
      candidate.childTaskId === child.id &&
      candidate.requirementStatus === "required",
  );
  if (
    parent.level !== 3 ||
    relations.executionSource?.mode !== "modules" ||
    !currentRequired
  ) {
    throw new TaskcraftError(ERROR_CODES.TC_SPEC_BINDING_INVALID, {
      problem: `Child ${child.id} is not a current required module of an L3 execution revision`,
      impact: "No child or parent lifecycle facts were written",
      remediation: `Inspect the current parent contract with: tc task show ${parent.id} --json`,
      context: { taskId: child.id, parentTaskId: parent.id },
    });
  }
  return parent;
}
