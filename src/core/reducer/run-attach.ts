// runAttach: records an existing host run against the active node attempt of
// the current lifecycle revision in one CAS-guarded transaction. Only the
// agent_runs observation row is written (plus the audit event): observations
// never drive task status, the projector derives the public states from
// attempt facts alone (product spec: Runtime observation is a separate
// layer). The reducer is the single write entry for agent_runs.

import type { TaskcraftDatabase } from "../../store/database.js";
import { getAttempts } from "../../store/query.js";
import type { ObservationStatus } from "../../store/query.js";
import { withTransaction } from "../../store/transaction.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import { L1_DEFAULT_ACTOR } from "../lifecycle/l1.js";
import type { CommandData } from "./context.js";
import {
  assertNotCancelled,
  attemptRefError,
  commandData,
  resolveSnapshot,
  snapshotOf,
} from "./context.js";
import { bumpRevision, insertEvent, nowIso } from "./shared.js";

export const OBSERVATION_STATUSES: readonly ObservationStatus[] = [
  "pending",
  "running",
  "stale",
  "finished",
  "failed",
  "unsupported",
];

export interface RunAttachInput {
  /** Target node of the current lifecycle revision (default execute-1). */
  nodeId: string;
  /** Host-side run id of the existing agent run (required, non-empty). */
  hostRunId: string;
  hostSessionId?: string;
  /** Host the run belongs to; defaults to the shared CLI actor. */
  host?: string;
  observationStatus?: ObservationStatus;
  expectedRevision?: number;
  actorInstanceId?: string;
}

export interface RunAttachResult extends CommandData {
  /** Written agent_runs row id (ar-<n>, global counter pattern). */
  runId: string;
  /** The current-revision attempt the observation is bound to. */
  nodeAttemptId: string;
  observationStatus: ObservationStatus;
}

export function runAttach(
  database: TaskcraftDatabase,
  taskId: string,
  input: RunAttachInput,
): RunAttachResult {
  return withTransaction(database, () => {
    const snapshot = resolveSnapshot(database, taskId, input.expectedRevision);
    assertNotCancelled(snapshot);
    const host = (input.host ?? L1_DEFAULT_ACTOR).trim();
    const hostRunId = input.hostRunId.trim();

    if (host === "") {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
        problem: "run attach requires a non-empty --host",
        impact: "No facts were written",
        remediation:
          "Retry with the host that owns the run: --host codex|claude",
        context: { taskId },
      });
    }

    if (hostRunId === "") {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
        problem: "run attach requires a non-empty --host-run-id",
        impact: "No facts were written",
        remediation: "Retry with the host run id: --host-run-id <id>",
        context: { taskId },
      });
    }

    if (
      input.observationStatus !== undefined &&
      !OBSERVATION_STATUSES.includes(input.observationStatus)
    ) {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
        problem: `Unknown observation status: ${input.observationStatus}`,
        impact: "No facts were written",
        remediation: `Retry with one of: ${OBSERVATION_STATUSES.join("|")}`,
        context: { taskId, status: input.observationStatus },
      });
    }

    const attempt = getAttempts(database, taskId)
      .filter(
        (candidate) =>
          candidate.lifecycleRevision === snapshot.currentLifecycleRevision &&
          candidate.nodeId === input.nodeId,
      )
      .at(-1);

    if (
      attempt === undefined ||
      (attempt.status !== "created" && attempt.status !== "running")
    ) {
      throw attemptRefError(
        taskId,
        `Node ${input.nodeId} has no active attempt in the current lifecycle revision; attach only registers an existing host run`,
        "Claim an attempt first with: tc run <task-id> --node <node-id>",
      );
    }

    const now = nowIso();
    const runId = nextAgentRunId(database);
    const observationStatus = input.observationStatus ?? "pending";

    database
      .prepare(
        `INSERT INTO agent_runs (
           id, task_id, node_attempt_id, host, host_run_id, host_session_id,
           observation_status, last_seen_at, finish_reason, observation_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
      )
      .run(
        runId,
        taskId,
        attempt.id,
        host,
        hostRunId,
        input.hostSessionId ?? null,
        observationStatus,
        now,
        null,
      );

    insertEvent(database, {
      taskId,
      lifecycleRevision: snapshot.currentLifecycleRevision,
      nodeId: attempt.nodeId,
      attemptId: attempt.id,
      eventType: "observation.attached",
      payload: {
        hostRunId,
        hostSessionId: input.hostSessionId ?? null,
        host,
        observationStatus,
      },
      postTaskRevision: snapshot.revision + 1,
      actorInstanceId: input.actorInstanceId ?? L1_DEFAULT_ACTOR,
      host,
      occurredAt: now,
    });
    bumpRevision(database, snapshot, now);

    return {
      ...commandData(database, taskId, snapshotOf(database, taskId)),
      runId,
      nodeAttemptId: attempt.id,
      observationStatus,
    };
  });
}

/** Global agent_runs id sequence: ar-<n> counting every row ever written. */
function nextAgentRunId(database: TaskcraftDatabase): string {
  const row = database
    .prepare("SELECT COUNT(*) AS n FROM agent_runs")
    .get() as {
    n: number;
  };

  return `ar-${row.n + 1}`;
}
