// CAS guard: read the current task snapshot, verify the caller's expected
// revision and return the snapshot for the reducer to write against. Reads
// happen on the same connection, so composing checkRevision with
// withTransaction keeps the check and the write in one transaction (TOCTOU
// safe); the caller owns that composition.

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import type { TaskcraftDatabase } from "./database.js";
import { getTask } from "./query.js";

export interface TaskSnapshot {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  objectiveMd: string;
  scopeJson: string;
  acceptanceJson: string;
  nonGoalsJson: string;
  classificationFactsJson: string;
  classificationReasonsJson: string;
  parentTaskId: string | null;
  activatedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  currentLifecycleRevision: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export function checkRevision(
  database: TaskcraftDatabase,
  taskId: string,
  expectedRevision: number,
): TaskSnapshot {
  const snapshot = getTask(database, taskId);

  if (snapshot === null) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_NOT_FOUND, {
      problem: `Task ${taskId} does not exist`,
      impact: "The command cannot be applied because its task is unknown",
      remediation: "List known tasks with: tc task list",
      context: { taskId },
    });
  }

  if (snapshot.revision !== expectedRevision) {
    throw new TaskcraftError(ERROR_CODES.TC_REVISION_CONFLICT, {
      problem: `Task ${taskId} revision mismatch: expected ${expectedRevision}, current is ${snapshot.revision}`,
      impact:
        "The command was rejected because it was based on a stale task snapshot",
      remediation: "Re-read the latest state with: tc status --json",
      context: {
        taskId,
        expectedRevision,
        currentRevision: snapshot.revision,
      },
    });
  }

  return snapshot;
}
