// tc enable off|ask|always: read-modify-write .taskcraft/config.json with an
// atomic tmp+rename (other fields such as agents are preserved). off must
// mean zero hook output, so the gate decisions are re-verified after writing.

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Command } from "commander";

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import { runEntryGate } from "../hooks/entry.js";
import { runStopGate } from "../hooks/stop.js";
import { CONFIG_FILE_NAME, readTaskcraftConfig } from "../hooks/shared.js";
import type { TakeOverMode, TaskcraftConfig } from "../hooks/shared.js";
import { isTakeOverMode } from "../hooks/shared.js";
import {
  execute,
  isJsonMode,
  printCommandResult,
  taskcraftDirectory,
} from "./helpers.js";

export interface EnableData {
  takeOver: TakeOverMode;
  configPath: string;
  entryOutput: string | null;
  stopOutput: string | null;
}

/** Parses the mode argument; anything else fails with a stable error and a
 * remediation that names the allowed values. */
export function parseMode(value: string): TakeOverMode {
  if (!isTakeOverMode(value)) {
    throw new TaskcraftError(ERROR_CODES.TC_TASK_INPUT_INVALID, {
      problem: `enable mode must be off, ask or always, got: ${value}`,
      impact: "The takeover mode was not changed",
      remediation: "Re-run: tc enable off|ask|always",
      context: { mode: value },
    });
  }

  return value;
}

/** Reads .taskcraft/config.json, switches takeOver and writes it back with an
 * atomic tmp+rename. A missing config starts from an empty object; unknown
 * fields survive untouched. After writing, off re-verifies that both gates
 * stay silent (REQ-03: `enable off` must mean zero hook output). */
export function applyTakeOver(
  configPath: string,
  takeOver: TakeOverMode,
): EnableData {
  const existing = readExistingConfig(configPath);
  atomicWriteJson(configPath, { ...existing, takeOver });

  if (takeOver === "off") {
    const entry = runEntryGate(configPath);
    const stop = runStopGate(configPath);

    if (entry.output !== null || stop.output !== null) {
      throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED, {
        problem: "off mode must produce zero hook output",
        impact: "Hooks could still inject or block while takeover is off",
        remediation:
          "Inspect the config with: cat .taskcraft/config.json, then re-run: tc enable off",
        context: { configPath },
      });
    }

    return { takeOver, configPath, entryOutput: null, stopOutput: null };
  }

  return { takeOver, configPath, entryOutput: null, stopOutput: null };
}

function readExistingConfig(configPath: string): TaskcraftConfig {
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    return readTaskcraftConfig(configPath);
  } catch (cause) {
    throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED, {
      problem: `Cannot read the takeover config: ${describeCause(cause)}`,
      impact: "The takeover mode was not changed",
      remediation:
        "Re-run: tc init --agent codex|claude, then tc enable <mode>",
      context: { configPath },
      cause,
    });
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.config.json.tmp-${process.pid}`);
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporary, path);
  } catch (cause) {
    throw new TaskcraftError(ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED, {
      problem: `Could not write ${path}: ${describeCause(cause)}`,
      impact: "The takeover mode was not changed",
      remediation:
        "Check the .taskcraft/ directory permissions, then re-run: tc enable <mode>",
      context: { path },
      cause,
    });
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function register(program: Command): void {
  program
    .command("enable")
    .description("set the takeover mode: off, ask or always")
    .argument("<mode>", "off, ask or always")
    .action(async (mode: string, _options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const takeOver = parseMode(mode);
        const configPath = join(taskcraftDirectory(), CONFIG_FILE_NAME);
        const data = applyTakeOver(configPath, takeOver);

        if (json) {
          printCommandResult(data);
          return;
        }

        console.log(`Takeover mode: ${data.takeOver}`);
        console.log(`Config: ${data.configPath}`);
        const hookStatus =
          data.takeOver === "off"
            ? "silent (zero output)"
            : `active (${data.takeOver})`;
        console.log(`Entry hook: ${hookStatus}`);
        console.log(`Stop hook: ${hookStatus}`);
      }, json);
    });
}
