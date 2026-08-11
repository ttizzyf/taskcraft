// Public entry of the single reducer. The implementation lives in
// src/core/reducer/ (one file per command) so every file stays under the
// 400 effective-line limit; this barrel keeps the consumer interface stable.

export { taskNew } from "./reducer/task-new.js";
export { run } from "./reducer/run.js";
export { runComplete } from "./reducer/run-complete.js";
export { cancel } from "./reducer/cancel.js";
export { recordAttemptFailure } from "./reducer/failure.js";
export type {
  AttemptFailureInput,
  CancelInput,
  CommandData,
  ExecuteResult,
  NodeBrief,
  RunCompleteInput,
  RunInput,
  TaskNewInput,
} from "./reducer/context.js";
