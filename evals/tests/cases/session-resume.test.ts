import { rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWorkspace,
  sourceSnapshot,
  writeJson,
  writeText,
} from "../../core/workspace.ts";
import { readTaskSnapshot, runTcCommand } from "../../core/tc.ts";
import type { EvalContext, HostRun, HostRunRequest } from "../../core/types.ts";
import { requireSuccess } from "../../cases/utils.ts";
import {
  sessionResumeCase,
  type SessionResumeEvidenceData,
  type SessionResumeSetupData,
} from "../../cases/session-resume.ts";

const cliPath = join(process.cwd(), "dist", "cli.js");
const directories: string[] = [];

const PARTIAL_SOURCE = `const pending = true; process.stdout.write(JSON.stringify({ pending }) + "\\n");`;

const CORRECT_SOURCE = `import { readFileSync } from "node:fs";
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

const RESULT_WITH_RECORD = {
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

type HostBehavior = (
  context: EvalContext,
  request: HostRunRequest,
  phase: string,
) => Promise<HostRun>;

afterEach(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
  directories.length = 0;
});

describe("session-resume case", () => {
  it("uses a new prompt to discover and finish the same task and attempt", async () => {
    const workspace = createTestWorkspace();
    const state = { setup: undefined as unknown as SessionResumeSetupData };
    const prompts: string[] = [];
    const context = contextFor(async (ctx, request, phase) => {
      prompts.push(request.prompt);
      expect(state.setup).toBeDefined();
      if (phase === "session-resume-first-session") {
        await createNormalHandoff(ctx, request.cwd, state.setup!);
        return hostRun(phase, "success");
      }
      await resumeFromDurableState(ctx, request.cwd);
      return hostRun(phase, "success");
    });

    state.setup = (await sessionResumeCase.prepare(
      context,
      workspace,
    )) as SessionResumeSetupData;
    const setup = state.setup;
    const execution = await sessionResumeCase.execute(
      context,
      setup,
      30_000,
      undefined,
    );
    const task = await context.readTask(workspace, setup.taskId);
    const checks = await sessionResumeCase.grade(
      context,
      setup,
      execution,
      task,
    );
    const evidence = sessionEvidence(setup);

    expect(execution.hostRuns.map((run) => run.status)).toEqual([
      "success",
      "success",
    ]);
    expect(evidence.established).toBe(true);
    expect(prompts[1]).toContain("tc task list --json");
    expect(prompts[1]).toContain("tc task show <task-id> --json");
    expect(prompts[1]).not.toContain(setup.taskId);
    expect(prompts[1]).not.toContain(setup.requirement);
    expect(
      checks
        .filter((check) => check.grader === "code")
        .every((check) => check.verdict === "pass"),
    ).toBe(true);
    expect(
      checks.find((check) => check.id === "session-resume-attempt-identity")
        ?.verdict,
    ).toBe("pass");
    expect(task.snapshot?.status).toBe("done");
  });

  it("does not start a second session when the first host exits without a handoff", async () => {
    const workspace = createTestWorkspace();
    let hostCalls = 0;
    const context = contextFor(async (_ctx, _request, phase) => {
      hostCalls += 1;
      return hostRun(phase, "success");
    });
    const setup = (await sessionResumeCase.prepare(
      context,
      workspace,
    )) as SessionResumeSetupData;

    const execution = await sessionResumeCase.execute(
      context,
      setup,
      30_000,
      undefined,
    );
    const task = await context.readTask(workspace, setup.taskId);
    const checks = await sessionResumeCase.grade(
      context,
      setup,
      execution,
      task,
    );

    expect(hostCalls).toBe(1);
    expect(sessionEvidence(setup).established).toBe(false);
    expect(
      checks.find((check) => check.id === "session-resume-handoff")?.verdict,
    ).toBe("inconclusive");
  });

  it.each(["error", "timeout", "interrupted"] as const)(
    "rejects a non-success first host even after source and fact writes",
    async (status) => {
      const workspace = createTestWorkspace();
      const state = { setup: undefined as unknown as SessionResumeSetupData };
      const context = contextFor(async (ctx, request, phase) => {
        if (phase === "session-resume-first-session") {
          await createNormalHandoff(ctx, request.cwd, state.setup!);
        }
        return hostRun(phase, status);
      });
      state.setup = (await sessionResumeCase.prepare(
        context,
        workspace,
      )) as SessionResumeSetupData;
      const setup = state.setup;

      const execution = await sessionResumeCase.execute(
        context,
        setup,
        30_000,
        undefined,
      );
      const checks = await sessionResumeCase.grade(
        context,
        setup,
        execution,
        await context.readTask(workspace, setup.taskId),
      );

      expect(sessionEvidence(setup).established).toBe(false);
      expect(
        checks.find((check) => check.id === "session-resume-handoff")?.verdict,
      ).toBe("inconclusive");
    },
  );

  it("does not treat a task completed by the first session as a normal handoff", async () => {
    const workspace = createTestWorkspace();
    const state = { setup: undefined as unknown as SessionResumeSetupData };
    const context = contextFor(async (ctx, request, phase) => {
      expect(phase).toBe("session-resume-first-session");
      await createNormalHandoff(ctx, request.cwd, state.setup!);
      await completeFromCurrentAttempt(ctx, request.cwd, state.setup!.taskId);
      return hostRun(phase, "success");
    });
    state.setup = (await sessionResumeCase.prepare(
      context,
      workspace,
    )) as SessionResumeSetupData;
    const setup = state.setup;

    const execution = await sessionResumeCase.execute(
      context,
      setup,
      30_000,
      undefined,
    );
    const task = await context.readTask(workspace, setup.taskId);
    const checks = await sessionResumeCase.grade(
      context,
      setup,
      execution,
      task,
    );

    expect(task.snapshot?.status).toBe("done");
    expect(sessionEvidence(setup).established).toBe(false);
    expect(
      checks.find((check) => check.id === "session-resume-handoff")?.verdict,
    ).toBe("inconclusive");
  });
});

function contextFor(behavior: HostBehavior): EvalContext {
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

function createTestWorkspace(): string {
  const workspace = createWorkspace("session-resume-test");
  directories.push(workspace);
  return workspace;
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

async function createNormalHandoff(
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

async function resumeFromDurableState(
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

async function completeFromCurrentAttempt(
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

function sessionEvidence(
  setup: SessionResumeSetupData,
): SessionResumeEvidenceData {
  const value = setup.metadata.sessionResume.evidence;
  if (value === null)
    throw new Error("session-resume evidence was not captured");
  return value;
}

function hostRun(phase: string, status: HostRun["status"]): HostRun {
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
