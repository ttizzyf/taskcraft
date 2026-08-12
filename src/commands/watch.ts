// tc watch: starts the localhost watch server (random port by default),
// prints the deep-linkable URL, opens the browser unless --no-open, and
// keeps the process alive until Ctrl-C.

import { fileURLToPath } from "node:url";

import { Command, InvalidArgumentError } from "commander";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { MigrationError } from "../store/migrations.js";
import { getTask } from "../store/query.js";
import { createWatchServer } from "../watch/server.js";
import type { WatchServerOptions } from "../watch/server.js";
import { openTaskcraftDatabase } from "./helpers.js";

const WATCH_STATIC_DIRECTORY = fileURLToPath(
  new URL("../../watch", import.meta.url),
);

interface WatchOptions {
  task?: string;
  port: number;
  open: boolean;
}

export function register(program: Command): void {
  program
    .command("watch")
    .description("serve the read-only watch UI and JSON API on localhost")
    .option("--task <id>", "task id to deep-link to (#/task/<id>)")
    .option("--port <n>", "port to bind; 0 picks a random port", parsePort, 0)
    .option("--no-open", "print the URL without opening a browser")
    .action(async (options: WatchOptions) => {
      try {
        await startWatch(options);
      } catch (error) {
        writeWatchError(error);
        process.exitCode = 1;
      }
    });
}

function parsePort(value: string): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new InvalidArgumentError(
      `--port must be an integer between 0 and 65535, got: ${value}`,
    );
  }

  return port;
}

async function startWatch(options: WatchOptions): Promise<void> {
  if (options.task !== undefined) {
    validateTask(options.task);
  }

  const urlPath =
    options.task === undefined ? "/#/board" : `/#/task/${options.task}`;
  const serverOptions: WatchServerOptions = {
    projectDir: process.cwd(),
    staticDir: WATCH_STATIC_DIRECTORY,
    port: options.port,
    openBrowser: options.open,
    browserUrl: urlPath,
  };
  const { server, port } = await createWatchServer(serverOptions);

  console.log(`Taskcraft watch server: http://127.0.0.1:${port}${urlPath}`);
  console.log("Press Ctrl-C to stop");

  process.once("SIGINT", () => {
    server.close();
    process.exit(0);
  });
}

/** Deep links must point at a real task; the URL is printed only after the
 * server starts, so an unknown id fails fast with a stable error. */
function validateTask(taskId: string): void {
  const database = openTaskcraftDatabase(true);

  try {
    if (getTask(database, taskId) === null) {
      throw new TaskcraftError(ERROR_CODES.TC_TASK_NOT_FOUND, {
        problem: `Task ${taskId} does not exist`,
        impact: "The watch server cannot deep-link to an unknown task",
        remediation: "List known tasks with: tc task list",
        context: { taskId },
      });
    }
  } finally {
    database.close();
  }
}

function writeWatchError(error: unknown): void {
  if (error instanceof TaskcraftError) {
    process.stderr.write(
      `error: ${error.code}: ${error.problem}\n` +
        `impact: ${error.impact}\n` +
        `remediation: ${error.remediation}\n`,
    );
    return;
  }

  if (error instanceof MigrationError) {
    process.stderr.write(`error: ${error.code}: ${error.message}\n`);
    return;
  }

  process.stderr.write(
    `internal error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}
