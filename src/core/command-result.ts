// tc-command-result/v1 constructors. Every command boundary serializes its
// outcome through these types: success carries `data`, failure carries stable
// errors with problem/impact/remediation. The CLI wiring lives in a later
// task; this module only builds and maps the shapes.

import type { TaskcraftError } from "./errors.js";

export const COMMAND_RESULT_SCHEMA_VERSION = "tc-command-result/v1";

export interface CommandResultError {
  code: string;
  problem: string;
  impact: string;
  remediation: string;
}

export interface CommandResultSuccess<T> {
  schemaVersion: "tc-command-result/v1";
  ok: true;
  data: T;
  errors: [];
}

export interface CommandResultFailure {
  schemaVersion: "tc-command-result/v1";
  ok: false;
  data: null;
  errors: CommandResultError[];
}

export type CommandResult<T> = CommandResultSuccess<T> | CommandResultFailure;

export function commandOk<T>(data: T): CommandResultSuccess<T> {
  return {
    schemaVersion: COMMAND_RESULT_SCHEMA_VERSION,
    ok: true,
    data,
    errors: [],
  };
}

export function commandFailure(
  errors: readonly CommandResultError[],
): CommandResultFailure {
  return {
    schemaVersion: COMMAND_RESULT_SCHEMA_VERSION,
    ok: false,
    data: null,
    errors: [...errors],
  };
}

/** Maps a TaskcraftError to the stable command-result error shape. */
export function errorFromTaskcraftError(
  error: TaskcraftError,
): CommandResultError {
  return {
    code: error.code,
    problem: error.problem,
    impact: error.impact,
    remediation: error.remediation,
  };
}
