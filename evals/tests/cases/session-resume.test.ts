import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { aggregate } from "../../core/runner.ts";
import {
  sessionResumeCase,
  type SessionResumeSetupData,
} from "../../cases/session-resume.ts";
import {
  completeFromCurrentAttempt,
  contextFor,
  createTestWorkspace as createWorkspaceFixture,
  createNormalHandoff,
  hostRun,
  resumeFromDurableState,
  sessionEvidence,
} from "./session-resume-fixtures.ts";

const directories: string[] = [];

function createTestWorkspace(): string {
  const workspace = createWorkspaceFixture();
  directories.push(workspace);
  return workspace;
}

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
    expect(
      checks.some(
        (check) => check.grader === "code" && check.verdict === "fail",
      ),
    ).toBe(false);
    expect(aggregate(execution.hostRuns, checks).verdict).toBe("inconclusive");
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
