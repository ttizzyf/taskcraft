import type { TaskcraftDatabase } from "./database.js";

export type ObservationStatus =
  "pending" | "running" | "stale" | "finished" | "failed" | "unsupported";

export interface AgentRunRow {
  id: string;
  taskId: string;
  nodeAttemptId: string;
  host: string;
  hostRunId: string | null;
  hostSessionId: string | null;
  observationStatus: ObservationStatus;
  lastSeenAt: string | null;
  finishReason: string | null;
  observationJson: string;
}

export function getAgentRuns(
  database: TaskcraftDatabase,
  taskId?: string,
): AgentRunRow[] {
  return taskId === undefined
    ? (database
        .prepare(
          `SELECT id, task_id AS taskId,
                  node_attempt_id AS nodeAttemptId,
                  host, host_run_id AS hostRunId,
                  host_session_id AS hostSessionId,
                  observation_status AS observationStatus,
                  last_seen_at AS lastSeenAt,
                  finish_reason AS finishReason,
                  observation_json AS observationJson
           FROM agent_runs
           ORDER BY rowid`,
        )
        .all() as AgentRunRow[])
    : (database
        .prepare(
          `SELECT id, task_id AS taskId,
                  node_attempt_id AS nodeAttemptId,
                  host, host_run_id AS hostRunId,
                  host_session_id AS hostSessionId,
                  observation_status AS observationStatus,
                  last_seen_at AS lastSeenAt,
                  finish_reason AS finishReason,
                  observation_json AS observationJson
           FROM agent_runs
           WHERE task_id = ?
           ORDER BY rowid`,
        )
        .all(taskId) as AgentRunRow[]);
}
