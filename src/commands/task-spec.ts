import type { Command } from "commander";

import {
  assertSedimentableTask,
  getTaskSpecRefreshSelections,
  specSediment,
  taskSpecRefresh,
} from "../core/reducer.js";
import type { SpecSedimentData } from "../core/reducer.js";
import {
  appendSpecRegistryEntry,
  loadSpecRegistry,
  parseSpecSedimentationIds,
  resolveSpecSelections,
  resolveSpecSedimentationIds,
  sedimentationInvalid,
} from "../spec/index.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  parseRegistryEntriesInput,
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

  spec
    .command("sediment")
    .description("record the Spec documents a done task touched")
    .argument("<task>", "task id")
    .requiredOption("--reason <reason>", "why this sedimentation is recorded")
    .option(
      "--spec <spec-id>",
      "Spec id this task touched (repeatable)",
      collectSpecId,
      [] as string[],
    )
    .option(
      "--register <register>",
      "new Registry entries to append first: JSON array, @path or @-",
    )
    .option("--expected-revision <n>", "expected requested task revision")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);
      await execute(() => {
        // Every read-only check runs before the first write: a rejected
        // sedimentation must not append a Registry entry, and must not leave
        // one behind when the Store then refuses the fact.
        const expectedRevision = parseExpectedRevision(
          options.expectedRevision,
        );
        const specIds = parseSpecSedimentationIds(options.spec);
        const entries =
          options.register === undefined
            ? null
            : parseRegistryEntriesInput(options.register, "--register");
        if (options.reason.trim() === "") {
          throw sedimentationInvalid(
            "Spec sedimentation requires a non-empty reason",
          );
        }

        const database = openTaskcraftDatabase(true);
        try {
          assertSedimentableTask(database, taskId, expectedRevision);

          if (entries !== null) {
            for (const entry of entries) {
              appendSpecRegistryEntry(process.cwd(), entry);
            }
          }

          // Resolved after the append, so a Spec registered by this same
          // command is already discoverable.
          const resolvedSpecIds = resolveSpecSedimentationIds(
            loadSpecRegistry(process.cwd()),
            specIds,
          );

          const result = specSediment(database, taskId, {
            reason: options.reason,
            specIds: resolvedSpecIds,
            ...(expectedRevision === undefined ? {} : { expectedRevision }),
          });

          if (json) printCommandResult(result);
          else console.log(renderSediment(result));
        } finally {
          database.close();
        }
      }, json);
    });
}

function collectSpecId(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function renderSediment(data: SpecSedimentData): string {
  return [
    ...renderCommandData(data).split("\n"),
    `Specs: ${data.specIds.join(", ")}`,
    `Recorded: ${data.inserted ? "yes" : "already present (replay no-op)"}`,
  ].join("\n");
}
