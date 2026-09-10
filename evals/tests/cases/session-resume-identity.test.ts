import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkspace } from "../../core/workspace.ts";
import type {
  CaseExecution,
  EvalContext,
  TaskReadResult,
} from "../../core/types.ts";
import {
  sessionResumeCase,
  type SessionResumeSetupData,
} from "../../cases/session-resume.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories)
    rmSync(directory, { recursive: true, force: true });
  directories.length = 0;
});

describe("session-resume identity grading", () => {
  it("rejects swapped task and execute attempt identities despite done status", async () => {
    const workspace = createWorkspace("session-resume-identity-test");
    directories.push(workspace);
    const setup = {
      taskId: "T-1",
      workspace,
      requirement: "fixture requirement",
      modelCriteria: [],
      metadata: {
        sessionResume: {
          handoffFactSubject: "session-handoff",
          evidence: {
            established: true,
            taskId: "T-1",
            firstAttemptId: "att-T-1-execute-1-1",
            firstHostStatus: "success",
            firstTaskStatus: "active",
            initialSourceFiles: [],
            sourceFilesAfterFirst: [],
            handoffFactId: "fact-1",
            capturedAt: new Date().toISOString(),
            reason: "test evidence",
          },
        },
      },
    } as SessionResumeSetupData;
    const execution: CaseExecution = {
      hostRuns: [
        hostRun("session-resume-first-session"),
        hostRun("session-resume-second-session"),
      ],
    };
    const task: TaskReadResult = {
      error: null,
      snapshot: {
        taskId: "T-swapped",
        status: "done",
        taskRevision: 4,
        attempts: [
          {
            id: "att-swapped-execute-1-1",
            nodeId: "execute-1",
            status: "finished",
            outcome: "success",
          },
        ],
        evidence: [],
        facts: [],
      },
    };

    const checks = await sessionResumeCase.grade(
      contextStub(),
      setup,
      execution,
      task,
    );

    expect(
      checks.find((check) => check.id === "session-resume-task-identity")
        ?.verdict,
    ).toBe("fail");
    expect(
      checks.find((check) => check.id === "session-resume-attempt-identity")
        ?.verdict,
    ).toBe("fail");
  });
});

function contextStub(): EvalContext {
  return {
    repoRoot: process.cwd(),
    cliPath: "dist/cli.js",
    runTc: async () => ({ status: 0, stdout: "", stderr: "", elapsedMs: 0 }),
    readTask: async () => ({ snapshot: null, error: null }),
    hashSources: async () => [],
    host: {
      run: async () => {
        throw new Error("not used");
      },
    },
  };
}

function hostRun(phase: string) {
  return {
    phase,
    status: "success" as const,
    exitCode: 0,
    signal: null,
    elapsedMs: 1,
    callCount: 1,
    resultText: "done",
    diagnostics: [],
    hostVersion: "fake-host",
    model: "fake-model",
    resultMetadata: null,
  };
}
