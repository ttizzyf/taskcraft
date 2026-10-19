// Post-completion Spec sedimentation command.
//
// This is the only legal write path for knowledge a finished task produced: it
// records which Spec documents the task touched. It appends an immutable fact,
// creates no obligation and never touches the obligation results, so a task
// that already reached `done` stays done whether sedimentation succeeds, fails
// or is replayed.

import {
  parseSpecSedimentationIds,
  sedimentationInvalid,
} from "../../spec/sediment.js";
import type { TaskcraftDatabase } from "../../store/database.js";
import { insertSpecSedimentationResult } from "../../store/spec-sedimentation-facts.js";
import { project } from "../projector.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import { withTransaction } from "../../store/transaction.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import type { SpecSedimentData, SpecSedimentInput } from "./context.js";
import {
  assertNotCancelled,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import { bumpRevision, insertEvent, nowIso } from "./shared.js";

/** Requires the task to exist, not be cancelled and already be done.
 *
 * Shared by the command boundary and the reducer transaction: the boundary
 * runs it before appending Registry entries, the reducer re-runs it inside the
 * transaction so the rule has exactly one implementation. */
export function assertSedimentableTask(
  database: TaskcraftDatabase,
  taskId: string,
  expectedRevision?: number,
): TaskSnapshot {
  const requested = resolveSnapshot(database, taskId, expectedRevision);
  assertNotCancelled(requested);

  const status = project(database, taskId).status;
  if (status !== "done") {
    throw sedimentationInvalid(
      `Task ${taskId} is ${status}; Spec sedimentation is an output of a done task`,
    );
  }

  return requested;
}

export function specSediment(
  database: TaskcraftDatabase,
  taskId: string,
  input: SpecSedimentInput,
): SpecSedimentData {
  return withTransaction(database, () => {
    const requested = assertSedimentableTask(
      database,
      taskId,
      input.expectedRevision,
    );

    if (input.reason.trim() === "") {
      throw sedimentationInvalid(
        "Spec sedimentation requires a non-empty reason",
      );
    }

    const specIds = parseSpecSedimentationIds(input.specIds).sort();
    const revision = requested.currentLifecycleRevision;
    const actor = input.actorInstanceId ?? L1_DEFAULT_ACTOR;
    const now = nowIso();

    const inserted = insertSpecSedimentationResult(database, {
      taskId,
      lifecycleRevision: revision,
      specIds,
      reason: input.reason,
      actor,
      now,
    });

    if (!inserted) {
      // The identical list is already recorded: report the existing fact
      // without writing an event or advancing the CAS revision.
      return {
        ...commandData(database, taskId, snapshotOf(database, taskId)),
        specIds,
        inserted: false,
      };
    }

    insertEvent(database, {
      taskId,
      lifecycleRevision: revision,
      nodeId: null,
      attemptId: null,
      eventType: "task.spec_sedimented",
      payload: { specIds, reason: input.reason },
      postTaskRevision: requested.revision + 1,
      actorInstanceId: actor,
      host: null,
      occurredAt: now,
    });
    bumpRevision(database, requested, now);

    return {
      ...commandData(database, taskId, snapshotOf(database, taskId)),
      specIds,
      inserted: true,
    };
  });
}
