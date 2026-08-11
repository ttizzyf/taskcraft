// tc task show: renders the task card from the query model and the
// projector. text and JSON consume the same data object; the JSON data can
// drive the text renderer unchanged (same-source rendering).

import type { Command } from "commander";

import { project } from "../core/projector.js";
import type { TaskcraftDatabase } from "../store/database.js";
import { getAttempts, getEvidence, getTask } from "../store/query.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  printCommandResult,
} from "./helpers.js";
import type {
  EvidenceSummary,
  AttemptSummary,
  TaskShowData,
} from "./render.js";
import { renderTaskShowData } from "./render.js";

export function register(task: Command): void {
  task
    .command("show")
    .description("show a task card")
    .argument("<task>", "task id")
    .action(async (taskId, _options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const database = openTaskcraftDatabase(true);

        try {
          const data = buildTaskShowData(database, taskId);

          if (json) {
            printCommandResult(data);
          } else {
            console.log(renderTaskShowData(data));
          }
        } finally {
          database.close();
        }
      }, json);
    });
}

function buildTaskShowData(
  database: TaskcraftDatabase,
  taskId: string,
): TaskShowData {
  const projection = project(database, taskId);
  const snapshot = getTask(database, taskId)!;
  const attempts: AttemptSummary[] = getAttempts(database, taskId)
    .filter(
      (attempt) =>
        attempt.lifecycleRevision === snapshot.currentLifecycleRevision,
    )
    .map((attempt) => ({
      id: attempt.id,
      nodeId: attempt.nodeId,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      outcome: attempt.outcome,
      resultJson: attempt.resultJson,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
    }));
  const evidence: EvidenceSummary[] = getEvidence(database, taskId).map(
    (row) => ({
      id: row.id,
      type: row.type,
      reference: row.reference,
      summary: row.summary,
      nodeAttemptId: row.nodeAttemptId,
    }),
  );

  return {
    taskId,
    title: snapshot.title,
    level: snapshot.level,
    status: projection.status,
    taskRevision: snapshot.revision,
    lifecycleRevision: snapshot.currentLifecycleRevision,
    objective: snapshot.objectiveMd,
    scope: JSON.parse(snapshot.scopeJson) as unknown,
    acceptance: JSON.parse(snapshot.acceptanceJson) as unknown[],
    createdAt: snapshot.createdAt,
    waitingReason: projection.waitingReason,
    next: projection.next,
    attempts,
    evidence,
    breadcrumb: projection.breadcrumb,
  };
}
