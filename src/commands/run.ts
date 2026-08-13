// tc run: the single activation entry. Activates a queued task and claims
// the first attempt in one reducer transaction, or claims the target node
// attempt on an already-active task. Outputs the command data plus the pure
// data Node Brief (objective, required obligations, inline result schema,
// registered completion command).

import type { Command } from "commander";

import { run } from "../core/reducer.js";
import type { RunInput } from "../core/reducer.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  parseExpectedRevision,
  printCommandResult,
} from "./helpers.js";
import { renderRunData } from "./render.js";
import { register as registerRunAttach } from "./run-attach.js";
import { registerRunComplete } from "./run-complete.js";
import { register as registerRunFail } from "./run-fail.js";
import { register as registerRunRetry } from "./run-retry.js";
import { register as registerRunStatus } from "./run-status.js";

export function register(program: Command): void {
  const runCommand = program
    .command("run")
    .description("activate a task and claim the execute attempt")
    .argument("<task>", "task id")
    .option("--node <node>", "runnable node id to claim (default execute-1)")
    .option("--host <host>", "host name")
    .option("--expected-revision <n>", "expected task revision")
    .action(async (taskId, options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const database = openTaskcraftDatabase(true);

        try {
          const input: RunInput = {
            nodeId: options.node,
            host: options.host,
          };
          const expectedRevision = parseExpectedRevision(
            options.expectedRevision,
          );

          if (expectedRevision !== undefined) {
            input.expectedRevision = expectedRevision;
          }

          const data = run(database, taskId, input);

          if (json) {
            printCommandResult(data);
          } else {
            console.log(renderRunData(data));
          }
        } finally {
          database.close();
        }
      }, json);
    });

  registerRunComplete(runCommand);
  registerRunFail(runCommand);
  registerRunRetry(runCommand);
  registerRunAttach(runCommand);
  registerRunStatus(runCommand);
}
