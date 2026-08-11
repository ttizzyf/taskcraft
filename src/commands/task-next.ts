// tc task next: returns the runnable node summary and the unique next
// command from the projector, plus the per-node projection.

import type { Command } from "commander";

import { project } from "../core/projector.js";
import { getTask } from "../store/query.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  printCommandResult,
} from "./helpers.js";
import type { TaskNextData } from "./render.js";
import { renderTaskNextData } from "./render.js";

export function register(task: Command): void {
  task
    .command("next")
    .description("show the next runnable node and command for a task")
    .argument("<task>", "task id")
    .action(async (taskId, _options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const database = openTaskcraftDatabase(true);

        try {
          const projection = project(database, taskId);
          const snapshot = getTask(database, taskId)!;
          const data: TaskNextData = {
            taskId,
            taskRevision: snapshot.revision,
            status: projection.status,
            waitingReason: projection.waitingReason,
            next: projection.next,
            nodes: projection.nodeStatuses,
          };

          if (json) {
            printCommandResult(data);
          } else {
            console.log(renderTaskNextData(data));
          }
        } finally {
          database.close();
        }
      }, json);
    });
}
