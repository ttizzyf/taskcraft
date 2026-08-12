// tc task new: creates the card (revision 1, queued) through the reducer.
// Levels 1-3 materialize their built-in graph; other levels are rejected by
// the reducer with TC_TASK_LEVEL_UNSUPPORTED. --facts is parsed as JSON
// (@path / @- / raw) and persisted verbatim by the reducer; facts that are
// not a JSON object are rejected with TC_TASK_INPUT_INVALID.

import type { Command } from "commander";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { taskNew } from "../core/reducer.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseJsonInput,
  printCommandResult,
} from "./helpers.js";
import { renderCommandData } from "./render.js";

export function register(task: Command): void {
  task
    .command("new")
    .description("create a task card (level 1, 2 or 3)")
    .requiredOption("--title <title>", "task title")
    .requiredOption("--level <level>", "task level (1, 2 or 3)")
    .requiredOption("--reason <reason>", "creation judgment")
    .option("--facts <facts>", "classification facts: JSON, @path or @-")
    .action(async (options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const level = parseLevel(options.level);
        const classificationFacts =
          options.facts === undefined
            ? undefined
            : parseJsonInput(
                options.facts,
                ERROR_CODES.TC_TASK_INPUT_INVALID,
                "Facts",
              );
        const database = openTaskcraftDatabase(true);

        try {
          const data = taskNew(database, {
            title: options.title,
            level,
            reason: options.reason,
            classificationFacts,
          });

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

function parseLevel(value: string): number {
  const level = Number(value);

  if (!Number.isInteger(level) || level < 1) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
      problem: `Level must be a positive integer, got: ${value}`,
      impact: "The task was not created",
      remediation: "Retry with --level 1, 2 or 3",
    });
  }

  return level;
}
