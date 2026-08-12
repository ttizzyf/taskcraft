// tc init: idempotently creates .taskcraft/ + the Task Store database and
// applies migrations. An existing database is only checked, never overwritten
// (the migration ledger guards the schema; user data stays untouched).
// `--agent codex|claude` additionally installs the entry/stop hook scripts
// into .taskcraft/hooks/ and registers them in the project-level host config
// (write-if-absent: existing config content is never overwritten).

import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Command } from "commander";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { resolveAgentAdapter } from "./agent.js";
import type { AgentId } from "./agent.js";
import {
  execute,
  isJsonMode,
  openTaskcraftDatabase,
  printCommandResult,
  TASKCRAFT_DIRECTORY_NAME,
  TASKCRAFT_DATABASE_FILE,
} from "./helpers.js";

export interface InstallAgentResult {
  agent: AgentId;
  hookPaths: string[];
  configFile: string;
  /** Present when the host config already existed: hooks are installed but
   * not registered, reported explicitly instead of a silent partial success. */
  limitation?: string;
}

/** Installs the hook scripts and registers them in the project-level host
 * config for the given project directory. Only files under projectDir are
 * touched; unknown agents fail with TC_ADAPTER_UNSUPPORTED. */
export function installAgentHooks(
  agent: string,
  projectDir: string,
): InstallAgentResult {
  const adapter = resolveAgentAdapter(agent);
  const result = adapter.installEntry({ projectDir, takeOver: "ask" });

  if (!result.ok) {
    throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED, {
      problem: `Hook installation failed: ${result.limitation ?? "unknown error"}`,
      impact: "Entry hooks were not installed or registered",
      remediation:
        "Check the .taskcraft/ directory permissions, then re-run: tc init --agent <agent>",
      context: { agent: adapter.id },
    });
  }

  return {
    agent: adapter.id,
    hookPaths: result.hookPaths,
    configFile: hostConfigFile(adapter.id),
    ...(result.limitation === undefined
      ? {}
      : { limitation: result.limitation }),
  };
}

function hostConfigFile(agent: AgentId): string {
  return agent === "codex" ? ".codex/config.toml" : ".claude/settings.json";
}

export function register(program: Command): void {
  program
    .command("init")
    .description("initialize the Taskcraft store (idempotent)")
    .option("--agent <agent>", "also install entry hooks for codex or claude")
    .action(async (options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const directory = join(process.cwd(), TASKCRAFT_DIRECTORY_NAME);
        const databaseFile = join(directory, TASKCRAFT_DATABASE_FILE);
        const alreadyInitialized = existsSync(databaseFile);
        const database = openTaskcraftDatabase(false);
        database.close();

        const data: Record<string, unknown> = {
          directory,
          databaseFile,
          alreadyInitialized,
        };
        const installed =
          options.agent === undefined
            ? null
            : installAgentHooks(options.agent, process.cwd());

        if (installed !== null) {
          data.agent = installed.agent;
          data.hookPaths = installed.hookPaths;
          data.configFile = installed.configFile;

          if (installed.limitation !== undefined) {
            data.limitation = installed.limitation;
          }
        }

        if (json) {
          printCommandResult(data);
          return;
        }

        console.log(
          alreadyInitialized
            ? "Already initialized Taskcraft store"
            : "Initialized Taskcraft store",
        );
        console.log(`Directory: ${directory}`);
        console.log(`Database: ${databaseFile}`);

        if (installed !== null) {
          console.log(`Installed hooks for agent: ${installed.agent}`);
          console.log(`Hooks: ${installed.hookPaths.join(", ")}`);
          console.log(`Registered in: ${installed.configFile}`);

          if (installed.limitation !== undefined) {
            console.log(`Note: ${installed.limitation}`);
          }
        }
      }, json);
    });
}
