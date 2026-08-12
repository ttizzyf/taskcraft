// tc task fact add: appends one append-only task fact discovered by an
// attempt of the current revision. The category is pre-validated against
// the enum at the command boundary, --value reuses parseJsonInput (@path /
// @- / raw JSON) and every failure exits 1 with the stable error triple;
// the reducer re-validates the references and the value shape in the same
// transaction.

import type { Command } from "commander";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { taskFactAdd, TASK_FACT_CATEGORIES } from "../core/reducer.js";
import type { TaskFactAddInput } from "../core/reducer.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  parseJsonInput,
  printCommandResult,
} from "./helpers.js";
import { renderCommandData } from "./render.js";

export function register(task: Command): void {
  task
    .command("fact")
    .description("task fact management")
    .command("add")
    .description("append a task fact discovered by an attempt")
    .argument("<task>", "task id")
    .requiredOption(
      "--attempt <attempt-id>",
      "source attempt id of the current revision",
    )
    .requiredOption(
      "--category <category>",
      "fact category: intent, probe, constraint, assumption, dependency or environment",
    )
    .requiredOption("--subject <subject>", "fact subject")
    .requiredOption("--value <value>", "fact value JSON, @path or @-")
    .option("--evidence <evidence-id>", "backing evidence id of this task")
    .option("--supersedes <fact-id>", "fact id this fact supersedes")
    .option("--expected-revision <n>", "expected task revision")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const category = parseCategory(options.category);
        const value = parseJsonInput(
          options.value,
          ERROR_CODES.TC_FACT_INPUT_INVALID,
          "Fact value",
        );
        const expectedRevision = parseExpectedRevision(
          options.expectedRevision,
        );
        const input: TaskFactAddInput = {
          taskId,
          attemptId: options.attempt,
          category,
          subject: options.subject,
          value,
        };

        if (options.evidence !== undefined) {
          input.evidenceId = options.evidence;
        }

        if (options.supersedes !== undefined) {
          input.supersedesFactId = options.supersedes;
        }

        if (expectedRevision !== undefined) {
          input.expectedRevision = expectedRevision;
        }

        const database = openTaskcraftDatabase(true);

        try {
          const data = taskFactAdd(database, taskId, input);

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

function parseCategory(value: string): TaskFactAddInput["category"] {
  // Single source of truth: the enum constant exported by the core reducer;
  // this boundary check only fails earlier with the same error contract.
  if (!(TASK_FACT_CATEGORIES as readonly string[]).includes(value)) {
    throw new TaskcraftError(ERROR_CODES.TC_FACT_INPUT_INVALID, {
      problem: `--category must be one of ${TASK_FACT_CATEGORIES.join(", ")}, got: ${value}`,
      impact: "No facts were written",
      remediation: "Retry with a valid fact category",
      context: { category: value },
    });
  }

  return value as TaskFactAddInput["category"];
}
