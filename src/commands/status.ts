// tc status: shows the current task context. With exactly one active task
// (or a single task overall) it renders the full projected state, node
// list, obligation completion, next command and breadcrumb; otherwise it
// lists every task. All values come from the projector / query model.

import type { Command } from "commander";

import { project } from "../core/projector.js";
import type { TaskcraftDatabase } from "../store/database.js";
import { getTask, listTasks } from "../store/query.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  printCommandResult,
} from "./helpers.js";
import type {
  StatusData,
  StatusDetailData,
  StatusTaskEntry,
} from "./render.js";
import { renderStatusData } from "./render.js";

export function register(program: Command): void {
  program
    .command("status")
    .description("show the current task state and next command")
    .action(async (_options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const database = openTaskcraftDatabase(true);

        try {
          const data = buildStatusData(database);

          if (json) {
            printCommandResult(data);
          } else {
            console.log(renderStatusData(data));
          }
        } finally {
          database.close();
        }
      }, json);
    });
}

function buildStatusData(database: TaskcraftDatabase): StatusData {
  const tasks = listTasks(database);
  const entries: StatusTaskEntry[] = tasks.map((task) => {
    const projection = project(database, task.id);

    return {
      taskId: task.id,
      title: task.title,
      status: projection.status,
      taskRevision: task.revision,
      next: projection.next,
    };
  });

  const activeEntries = entries.filter((entry) => entry.status === "active");
  const currentTaskId =
    activeEntries.length === 1
      ? activeEntries[0]!.taskId
      : tasks.length === 1
        ? tasks[0]!.id
        : null;

  if (currentTaskId !== null) {
    return {
      currentTask: buildStatusDetail(database, currentTaskId),
      tasks: entries,
    };
  }

  return { currentTask: null, tasks: entries };
}

function buildStatusDetail(
  database: TaskcraftDatabase,
  taskId: string,
): StatusDetailData {
  const projection = project(database, taskId);
  const snapshot = getTask(database, taskId)!;

  return {
    taskId,
    title: snapshot.title,
    status: projection.status,
    taskRevision: snapshot.revision,
    waitingReason: projection.waitingReason,
    next: projection.next,
    nodes: projection.nodeStatuses,
    doneObligations: projection.doneObligations,
    totalObligations: projection.totalObligations,
    breadcrumb: projection.breadcrumb,
  };
}
