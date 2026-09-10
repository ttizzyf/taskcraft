import { buildBreadcrumb } from "../../src/core/breadcrumb.js";

export const CLAUDE_HOOK_EVENT = {
  type: "system",
  subtype: "hook_response",
  hook_event: "SessionStart",
  hook_name: "SessionStart:startup",
  hook_id: "hook-1",
  session_id: "session-1",
  exit_code: 0,
  outcome: "success",
  stderr: "",
  stdout: `Taskcraft Entry context:\n${JSON.stringify(
    buildBreadcrumb({
      task: {
        id: "T-1",
        level: 1,
        status: "active",
        taskRevision: 2,
        lifecycleRevision: 1,
        waitingReason: null,
        node: "execute-1",
        nodeKind: "execute",
      },
      nextCommand: "tc run complete T-1",
    }),
  )}\n`,
};
export const CLAUDE_RESULT_EVENT = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "TC_FIRST",
  session_id: "session-1",
};
export const CLAUDE_ENTRY_STREAM = [CLAUDE_HOOK_EVENT, CLAUDE_RESULT_EVENT]
  .map((event) => JSON.stringify(event))
  .join("\n");
