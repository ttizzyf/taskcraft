// Public entry of the single reducer. The implementation lives in
// src/core/reducer/ (one file per command) so every file stays under the
// 400 effective-line limit; this barrel keeps the consumer interface stable.

export { taskNew } from "./reducer/task-new.js";
export {
  getTaskSpecRefreshSelections,
  taskSpecRefresh,
} from "./reducer/task-spec-refresh.js";
export { taskFactAdd, TASK_FACT_CATEGORIES } from "./reducer/task-fact-add.js";
export type {
  TaskFactAddInput,
  TaskFactCategory,
  TaskFactResult,
} from "./reducer/task-fact-add.js";
export { run } from "./reducer/run.js";
export { runAttach } from "./reducer/run-attach.js";
export type { RunAttachInput, RunAttachResult } from "./reducer/run-attach.js";
export { runComplete } from "./reducer/run-complete.js";
export { cancel } from "./reducer/cancel.js";
export { taskWait, taskResume } from "./reducer/blocker.js";
export { runFail, runRetry } from "./reducer/failure.js";
export type { RetryResult } from "./reducer/failure.js";
export { reviewStart } from "./reducer/review-start.js";
export { reviewPass } from "./reducer/review-pass.js";
export { reviewChanges } from "./reducer/review-changes.js";
export { reviewReplan } from "./reducer/review-replan.js";
export type {
  AttemptFailureInput,
  CancelInput,
  CommandData,
  NodeBrief,
  ReviewChangesInput,
  ReviewPassInput,
  ReviewReplanInput,
  ReviewResultData,
  ReviewStartInput,
  RunCompleteInput,
  RunInput,
  RunRetryInput,
  TaskNewInput,
  TaskSpecRefreshData,
  TaskSpecRefreshInput,
  TaskResumeInput,
  TaskWaitInput,
  WaitingReasonCode,
} from "./reducer/context.js";
