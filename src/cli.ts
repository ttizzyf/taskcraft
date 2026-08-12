#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { Command } from "commander";

import { project } from "./core/projector.js";
import { listTasks } from "./store/query.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  printCommandResult,
} from "./commands/helpers.js";
import { register as registerAgent } from "./commands/agent.js";
import { register as registerEnable } from "./commands/enable.js";
import { register as registerInit } from "./commands/init.js";
import { register as registerReview } from "./commands/review.js";
import { register as registerRun } from "./commands/run.js";
import { register as registerStatus } from "./commands/status.js";
import { register as registerTaskCancel } from "./commands/task-cancel.js";
import { register as registerTaskFact } from "./commands/task-fact-add.js";
import { register as registerTaskNew } from "./commands/task-new.js";
import { register as registerTaskNext } from "./commands/task-next.js";
import { register as registerTaskShow } from "./commands/task-show.js";
import type { StatusTaskEntry } from "./commands/render.js";
import { renderCommandData, renderTaskList } from "./commands/render.js";

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as unknown;

  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("version" in packageJson) ||
    typeof packageJson.version !== "string"
  ) {
    throw new TypeError("package.json must contain a string version");
  }

  return packageJson.version;
}

const program = new Command()
  .name("tc")
  .description("Taskcraft command line interface")
  .version(readPackageVersion())
  .option("--json", "output the command result as JSON")
  .action(async (_options, command) => {
    const json = isJsonMode(command);

    await execute(() => {
      const database = openTaskcraftDatabase(true);

      try {
        const tasks = listTasks(database);
        const activeTasks = tasks.filter(
          (task) => project(database, task.id).status === "active",
        );

        if (activeTasks.length === 1) {
          const task = activeTasks[0]!;
          const projection = project(database, task.id);
          const data = {
            taskId: task.id,
            taskRevision: task.revision,
            status: projection.status,
            waitingReason: projection.waitingReason,
            next: projection.next,
          };

          if (json) {
            printCommandResult(data);
          } else {
            console.log(renderCommandData(data));
          }

          return;
        }

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

        if (json) {
          printCommandResult({ tasks: entries });
        } else {
          console.log(renderTaskList(entries));
        }
      } finally {
        database.close();
      }
    }, json);
  });

registerInit(program);
registerEnable(program);
registerAgent(program);

const task = program.command("task").description("task management");
registerTaskNew(task);
registerTaskFact(task);
registerTaskShow(task);
registerTaskNext(task);
registerTaskCancel(task);

registerRun(program);
registerReview(program);
registerStatus(program);

await program.parseAsync();
