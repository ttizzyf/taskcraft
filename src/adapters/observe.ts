// agent_runs observation writes shared by both host adapters: attaching a
// runtime observation in a transaction and mapping a run to the observation
// view. Missing optional fields stay empty (null / "pending" / "{}");
// observations never drive task status.

import { withTransaction } from "../store/transaction.js";
import type { TaskcraftDatabase } from "../store/database.js";
import type { AttachInput, HostRun, RuntimeObservation } from "./types.js";

/** Writes one agent_runs row in a transaction. */
export function attachObservation(
  database: TaskcraftDatabase,
  input: AttachInput,
  now: () => string,
): HostRun {
  return withTransaction(database, () => {
    const run: HostRun = {
      id: nextAgentRunId(database),
      taskId: input.taskId,
      nodeAttemptId: input.nodeAttemptId,
      host: input.host,
      hostRunId: input.hostRunId ?? null,
      hostSessionId: input.hostSessionId ?? null,
      observationStatus: input.observationStatus ?? "pending",
      lastSeenAt: input.lastSeenAt ?? now(),
      finishReason: input.finishReason ?? null,
      observationJson: JSON.stringify(input.observation ?? {}),
    };

    database
      .prepare(
        `INSERT INTO agent_runs (
           id, task_id, node_attempt_id, host, host_run_id, host_session_id,
           observation_status, last_seen_at, finish_reason, observation_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.taskId,
        run.nodeAttemptId,
        run.host,
        run.hostRunId,
        run.hostSessionId,
        run.observationStatus,
        run.lastSeenAt,
        run.finishReason,
        run.observationJson,
      );

    return run;
  });
}

function nextAgentRunId(database: TaskcraftDatabase): string {
  const row = database
    .prepare("SELECT COUNT(*) AS n FROM agent_runs")
    .get() as { n: number };

  return `ar-${row.n + 1}`;
}

/** Pure observation mapping: stamps a fresh last-seen on the run and keeps
 * the observed status; never maps to task completion. */
export function observeRun(
  run: HostRun,
  now: () => string,
): RuntimeObservation {
  const observation: RuntimeObservation = {
    status: run.observationStatus,
    lastSeenAt: run.lastSeenAt ?? now(),
  };

  if (run.finishReason !== null) {
    observation.finishReason = run.finishReason;
  }

  return observation;
}
