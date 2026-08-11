// Stable Taskcraft error taxonomy shared by the store, reducer and CLI layers.
// Every error thrown to a command boundary is a TaskcraftError carrying
// { code, problem, impact, remediation } plus optional context and cause.

export const ERROR_CODES = {
  TC_STORE_TRANSACTION_FAILED: "TC_STORE_TRANSACTION_FAILED",
  TC_NOT_INITIALIZED: "TC_NOT_INITIALIZED",
  TC_REVISION_CONFLICT: "TC_REVISION_CONFLICT",
  TC_TASK_NOT_FOUND: "TC_TASK_NOT_FOUND",
  TC_TASK_ALREADY_CANCELLED: "TC_TASK_ALREADY_CANCELLED",
  TC_TASK_LEVEL_UNSUPPORTED: "TC_TASK_LEVEL_UNSUPPORTED",
  TC_TASK_INPUT_INVALID: "TC_TASK_INPUT_INVALID",
  TC_ATTEMPT_REF_INVALID: "TC_ATTEMPT_REF_INVALID",
  TC_EVIDENCE_REF_INVALID: "TC_EVIDENCE_REF_INVALID",
  TC_LIFECYCLE_RESULT_INVALID: "TC_LIFECYCLE_RESULT_INVALID",
  TC_REQUIRED_OBLIGATION_MISSING: "TC_REQUIRED_OBLIGATION_MISSING",
} as const;

export type TaskcraftErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface TaskcraftErrorOptions {
  problem: string;
  impact: string;
  remediation: string;
  context?: Record<string, string | number | boolean | null>;
  cause?: unknown;
}

export class TaskcraftError extends Error {
  readonly code: TaskcraftErrorCode;
  readonly problem: string;
  readonly impact: string;
  readonly remediation: string;
  readonly context:
    Record<string, string | number | boolean | null> | undefined;

  constructor(code: TaskcraftErrorCode, options: TaskcraftErrorOptions) {
    super(options.problem, { cause: options.cause });
    this.name = "TaskcraftError";
    this.code = code;
    this.problem = options.problem;
    this.impact = options.impact;
    this.remediation = options.remediation;
    this.context = options.context;
  }
}
