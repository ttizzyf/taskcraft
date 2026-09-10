import { join } from "node:path";

import { readTaskSnapshot, runTcCommand } from "../../core/tc.ts";
import {
  createWorkspace,
  sourceSnapshot,
  writeJson,
  writeText,
} from "../../core/workspace.ts";
import type { EvalContext, HostRun, HostRunRequest } from "../../core/types.ts";
import { requireSuccess } from "../../cases/utils.ts";
import type {
  SessionResumeEvidenceData,
  SessionResumeSetupData,
} from "../../cases/session-resume.ts";

export const cliPath = join(process.cwd(), "dist", "cli.js");

export const PARTIAL_SOURCE =
  'const pending = true; process.stdout.write(JSON.stringify({ pending }) + "\\n");';

export const CORRECT_SOURCE = `import { readFileSync } from "node:fs";
const lines = readFileSync(0, "utf8").split(/\\r?\\n/).filter((line) => line.trim() !== "");
const parse = (line) => {
  const fields = [];
  const pattern = /(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g;
  let match;
  while ((match = pattern.exec(line)) !== null) fields.push((match[1] ?? match[2]).replaceAll('""', '"'));
  return fields;
};
if (lines[0]?.trim() !== "name,amount") throw new Error("expected name,amount header");
const totals = {};
let rows = 0;
for (const line of lines.slice(1)) {
  const fields = parse(line);
  if (fields.length !== 2 || fields[0]?.trim() === "") throw new Error("malformed row");
  const amount = Number(fields[1]);
  if (!Number.isFinite(amount)) throw new Error("amount must be numeric");
  totals[fields[0]] = (totals[fields[0]] ?? 0) + amount;
  rows += 1;
}
process.stdout.write(JSON.stringify({ rows, totals }) + "\\n");
`;

export const RESULT_WITH_RECORD = {
  summary: "completed after normal session handoff",
  evidence: [
    {
      type: "validation",
      reference: "src/csv-summary.mjs",
      summary: "independent CSV contract checks pass",
    },
  ],
  record: {
    summary: "recorded",
    specImpact: { outcome: "none", reason: "No reusable rule changed" },
  },
};

export type HostBehavior = (
  context: EvalContext,
  request: HostRunRequest,
  phase: string,
) => Promise<HostRun>;

export function contextFor(behavior: HostBehavior): EvalContext {
  const context: EvalContext = {
    repoRoot: process.cwd(),
    cliPath,
    runTc: (cwd, args, input) => runTcCommand(cliPath, cwd, args, input),
    readTask: (cwd, taskId) => readTaskSnapshot(cliPath, cwd, taskId),
    hashSources: async (workspace) => sourceSnapshot(workspace),
    host: { run: (request, phase) => behavior(context, request, phase) },
  };
  return context;
}

export function createTestWorkspace(): string {
  return createWorkspace("session-resume-test");
}

async function tcJson<T>(
  context: EvalContext,
  workspace: string,
  args: readonly string[],
  operation: string,
): Promise<T> {
  const result = requireSuccess(
    await context.runTc(workspace, args),
    operation,
  );
  return JSON.parse(result.stdout) as T;
}

export async function createNormalHandoff(
  context: EvalContext,
  workspace: string,
  setup: SessionResumeSetupData,
): Promise<string> {
  const started = await tcJson<{
    data?: { nodeBrief?: { attemptId?: unknown } };
  }>(
    context,
    workspace,
    [
      "run",
      setup.taskId,
      "--node",
      "execute-1",
      "--host",
      "fake-first-session",
      "--json",
    ],
    "fake first session tc run",
  );
  const attemptId = started.data?.nodeBrief?.attemptId;
  if (typeof attemptId !== "string")
    throw new Error("tc run returned no attempt id");
  writeText(workspace, "src/csv-summary.mjs", PARTIAL_SOURCE);
  writeJson(workspace, "handoff.json", { phase: "normal-session-handoff" });
  requireSuccess(
    await context.runTc(workspace, [
      "task",
      "fact",
      "add",
      setup.taskId,
      "--attempt",
      attemptId,
      "--category",
      "environment",
      "--subject",
      "session-handoff",
      "--value",
      "@handoff.json",
      "--json",
    ]),
    "fake first session handoff fact",
  );
  return attemptId;
}

export async function resumeFromDurableState(
  context: EvalContext,
  workspace: string,
): Promise<{ taskId: string; attemptId: string }> {
  const listed = await tcJson<{
    data?: { tasks?: Array<{ taskId?: unknown; status?: unknown }> };
  }>(
    context,
    workspace,
    ["task", "list", "--json"],
    "fake second session task list",
  );
  const task = listed.data?.tasks?.find(
    (candidate): candidate is { taskId: string; status?: unknown } =>
      typeof candidate.taskId === "string" && candidate.status !== "done",
  );
  if (task === undefined)
    throw new Error("fake second session found no unfinished task");
  const shown = await tcJson<{
    data?: {
      attempts?: Array<{ nodeId?: unknown; id?: unknown; status?: unknown }>;
    };
  }>(
    context,
    workspace,
    ["task", "show", task.taskId, "--json"],
    "fake second session task show",
  );
  const attempts = shown.data?.attempts?.filter(
    (attempt) =>
      attempt.nodeId === "execute-1" &&
      (attempt.status === "created" || attempt.status === "running"),
  );
  const attemptId = attempts?.[0]?.id;
  if (typeof attemptId !== "string" || attempts?.length !== 1) {
    throw new Error(
      "fake second session did not find exactly one open execute attempt",
    );
  }
  writeText(workspace, "src/csv-summary.mjs", CORRECT_SOURCE);
  writeJson(workspace, "resume-validation.json", { phase: "new-session" });
  requireSuccess(
    await context.runTc(workspace, [
      "task",
      "fact",
      "add",
      task.taskId,
      "--attempt",
      attemptId,
      "--category",
      "environment",
      "--subject",
      "resume-validation",
      "--value",
      "@resume-validation.json",
      "--json",
    ]),
    "fake second session validation fact",
  );
  writeJson(workspace, "result.json", RESULT_WITH_RECORD);
  requireSuccess(
    await context.runTc(workspace, [
      "run",
      "complete",
      task.taskId,
      "--result",
      "@result.json",
      "--json",
    ]),
    "fake second session completion",
  );
  return { taskId: task.taskId, attemptId };
}

export async function completeFromCurrentAttempt(
  context: EvalContext,
  workspace: string,
  taskId: string,
): Promise<void> {
  writeText(workspace, "src/csv-summary.mjs", CORRECT_SOURCE);
  writeJson(workspace, "result.json", RESULT_WITH_RECORD);
  await tcJson(
    context,
    workspace,
    ["run", "complete", taskId, "--result", "@result.json", "--json"],
    "fake first session premature completion",
  );
}

export function sessionEvidence(
  setup: SessionResumeSetupData,
): SessionResumeEvidenceData {
  const value = setup.metadata.sessionResume.evidence;
  if (value === null)
    throw new Error("session-resume evidence was not captured");
  return value;
}

export function hostRun(phase: string, status: HostRun["status"]): HostRun {
  return {
    phase,
    status,
    exitCode: status === "success" ? 0 : 1,
    signal: status === "interrupted" ? "SIGTERM" : null,
    elapsedMs: 1,
    callCount: 1,
    resultText: status === "success" ? "done" : null,
    diagnostics: [],
  };
}
