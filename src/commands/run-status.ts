// tc run status: read-only view of a task's node attempts and host
// observations. Every value comes from the query model (attempts +
// agent_runs); nothing is written, so text and JSON always show the same
// source the Watch runtime page renders.

import type { Command } from "commander";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { project } from "../core/projector.js";
import type { ProjectStatus } from "../core/projector.js";
import type { TaskcraftDatabase } from "../store/database.js";
import { getAgentRuns, getAttempts, getTask } from "../store/query.js";
import type { AttemptStatus, ObservationStatus } from "../store/query.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  printCommandResult,
} from "./helpers.js";

export interface RunStatusAttempt {
  id: string;
  lifecycleRevision: number;
  nodeId: string;
  attemptNumber: number;
  status: AttemptStatus;
  host: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunStatusObservation {
  runId: string;
  nodeAttemptId: string;
  host: string;
  hostRunId: string | null;
  hostSessionId: string | null;
  observationStatus: ObservationStatus;
  lastSeenAt: string | null;
  finishReason: string | null;
}

export interface RunStatusData {
  taskId: string;
  taskRevision: number;
  status: ProjectStatus;
  next: string | null;
  attempts: RunStatusAttempt[];
  runs: RunStatusObservation[];
}

/** Reads attempts and observations of one task; TC_TASK_NOT_FOUND when the
 * task is unknown (the same error the reducer entry points throw). */
export function buildRunStatus(
  database: TaskcraftDatabase,
  taskId: string,
): RunStatusData {
  const snapshot = getTask(database, taskId);

  if (snapshot === null) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_NOT_FOUND, {
      problem: `Task ${taskId} does not exist`,
      impact: "The command cannot be applied because its task is unknown",
      remediation: "List known tasks with: tc task list",
      context: { taskId },
    });
  }

  const projection = project(database, taskId);

  return {
    taskId,
    taskRevision: snapshot.revision,
    status: projection.status,
    next: projection.next,
    attempts: getAttempts(database, taskId).map((attempt) => ({
      id: attempt.id,
      lifecycleRevision: attempt.lifecycleRevision,
      nodeId: attempt.nodeId,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      host: attempt.host,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
    })),
    runs: getAgentRuns(database, taskId).map((run) => ({
      runId: run.id,
      nodeAttemptId: run.nodeAttemptId,
      host: run.host,
      hostRunId: run.hostRunId,
      hostSessionId: run.hostSessionId,
      observationStatus: run.observationStatus,
      lastSeenAt: run.lastSeenAt,
      finishReason: run.finishReason,
    })),
  };
}

export function renderRunStatus(data: RunStatusData): string {
  const lines = [
    `Task: ${data.taskId} (revision ${data.taskRevision})`,
    `Status: ${data.status}`,
    `Next: ${data.next ?? "(none)"}`,
    "Attempts:",
  ];

  if (data.attempts.length === 0) {
    lines.push("  (none)");
  } else {
    for (const attempt of data.attempts) {
      lines.push(
        `  ${attempt.id}  ${attempt.nodeId}  attempt ${attempt.attemptNumber}  ${attempt.status}  host ${attempt.host}`,
      );
    }
  }

  lines.push("Observations:");

  if (data.runs.length === 0) {
    lines.push("  (none)");
  } else {
    for (const run of data.runs) {
      lines.push(
        `  ${run.runId}  ${run.nodeAttemptId}  host ${run.host}  run id ${run.hostRunId ?? "(none)"}` +
          `  session ${run.hostSessionId ?? "(none)"}  ${run.observationStatus}` +
          `  last seen ${run.lastSeenAt ?? "(none)"}  finish ${run.finishReason ?? "(none)"}`,
      );
    }
  }

  return lines.join("\n");
}

export function register(program: Command): void {
  program
    .command("status")
    .description("show attempts and host observations of a task (read-only)")
    .argument("<task>", "task id")
    .action(async (taskId, _options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const database = openTaskcraftDatabase(true);

        try {
          const data = buildRunStatus(database, taskId);

          if (json) {
            printCommandResult(data);
          } else {
            console.log(renderRunStatus(data));
          }
        } finally {
          database.close();
        }
      }, json);
    });
}
