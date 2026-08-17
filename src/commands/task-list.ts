// tc task list: task summary table with an optional status filter. Every
// entry is projected from the same projector the status command uses;
// --status filters by the public statuses (queued, active, waiting, done,
// cancelled) and accepts comma-separated values.

import type { Command } from "commander";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { project } from "../core/projector.js";
import type { ProjectStatus } from "../core/projector.js";
import type { TaskcraftDatabase } from "../store/database.js";
import { listTasks } from "../store/query.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  printCommandResult,
} from "./helpers.js";
import type { TaskListEntry } from "./render.js";
import { renderTaskListEntries } from "./render.js";

const PUBLIC_STATUSES: readonly ProjectStatus[] = [
  "queued",
  "active",
  "waiting",
  "done",
  "cancelled",
];

export function register(task: Command): void {
  task
    .command("list")
    .description("list tasks with status, level and next command")
    .option(
      "--status <statuses>",
      "comma-separated status filter, e.g. active,waiting",
    )
    .action(async (options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const database = openTaskcraftDatabase(true);

        try {
          const filter = parseStatusFilter(options.status);
          const entries = buildTaskListEntries(database).filter(
            (entry) => filter === null || filter.has(entry.status),
          );

          if (json) {
            printCommandResult({ tasks: entries });
          } else {
            console.log(renderTaskListEntries(entries));
          }
        } finally {
          database.close();
        }
      }, json);
    });
}

function buildTaskListEntries(database: TaskcraftDatabase): TaskListEntry[] {
  return listTasks(database).map((snapshot) => {
    const projection = project(database, snapshot.id);

    return {
      taskId: snapshot.id,
      title: snapshot.title,
      level: snapshot.level,
      status: projection.status,
      taskRevision: snapshot.revision,
      parentTaskId: snapshot.parentTaskId,
      waitingReason: projection.waitingReason,
      next: projection.next,
    };
  });
}

/** Parses a comma-separated status filter; undefined or an empty list means
 * no filtering. Unknown statuses fail with the stable input error. */
function parseStatusFilter(
  value: string | undefined,
): Set<ProjectStatus> | null {
  if (value === undefined) {
    return null;
  }

  const statuses = new Set<ProjectStatus>();

  for (const part of value.split(",")) {
    const trimmed = part.trim();

    if (trimmed.length === 0) {
      continue;
    }

    if (!PUBLIC_STATUSES.includes(trimmed as ProjectStatus)) {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
        problem: `--status must be a comma-separated list of ${PUBLIC_STATUSES.join("|")}, got: ${trimmed}`,
        impact: "The task list was not shown",
        remediation: "Retry with a valid status, e.g. --status active,waiting",
      });
    }

    statuses.add(trimmed as ProjectStatus);
  }

  return statuses.size === 0 ? null : statuses;
}
