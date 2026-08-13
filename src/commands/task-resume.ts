// tc task resume: resolves the earliest open blocker through the reducer.
// Without --resolve the blocker must already have a satisfying constraint
// fact; --resolve is the explicit human override (also the escape hatch for
// a spent retry budget). Unresolved blockers are rejected with
// TC_BLOCKER_UNRESOLVED and zero writes.

import type { Command } from "commander";

import { taskResume } from "../core/reducer.js";
import type { TaskResumeInput } from "../core/reducer.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  printCommandResult,
} from "./helpers.js";
import { renderCommandData } from "./render.js";

export function register(task: Command): void {
  task
    .command("resume")
    .description("resolve the open blocker of a waiting task")
    .argument("<task>", "task id")
    .option("--resolve", "resolve without requiring a satisfying fact")
    .option("--expected-revision <n>", "expected task revision")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const expectedRevision = parseExpectedRevision(
          options.expectedRevision,
        );
        const input: TaskResumeInput = {};

        if (options.resolve === true) {
          input.resolve = true;
        }

        if (expectedRevision !== undefined) {
          input.expectedRevision = expectedRevision;
        }

        const database = openTaskcraftDatabase(true);

        try {
          const data = taskResume(database, taskId, input);

          if (json) {
            printCommandResult(data);
          } else {
            console.log(renderCommandData(data));
          }
        } finally {
          database.close();
        }
      }, json);
    });
}
