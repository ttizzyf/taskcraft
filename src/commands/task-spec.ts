import type { Command } from "commander";

import {
  getTaskSpecRefreshSelections,
  taskSpecRefresh,
} from "../core/reducer.js";
import { loadSpecRegistry, resolveSpecSelections } from "../spec/index.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  printCommandResult,
} from "./helpers.js";
import { renderCommandData } from "./render.js";

export function register(task: Command): void {
  const spec = task.command("spec").description("manage task Spec bindings");
  spec
    .command("refresh")
    .description("create a new lifecycle revision with current Spec snapshots")
    .argument("<task>", "task id")
    .requiredOption("--reason <reason>", "why the Spec contract is refreshed")
    .option("--expected-revision <n>", "expected requested task revision")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);
      await execute(() => {
        const database = openTaskcraftDatabase(true);
        try {
          const selections = getTaskSpecRefreshSelections(database, taskId);
          const resolvedSpecBindings =
            selections.length === 0
              ? []
              : resolveSpecSelections(
                  loadSpecRegistry(process.cwd()),
                  selections,
                );
          const expectedRevision = parseExpectedRevision(
            options.expectedRevision,
          );
          const result = taskSpecRefresh(database, taskId, {
            reason: options.reason,
            resolvedSpecBindings,
            ...(expectedRevision === undefined ? {} : { expectedRevision }),
          });
          if (json) printCommandResult(result);
          else console.log(renderCommandData(result));
        } finally {
          database.close();
        }
      }, json);
    });
}
