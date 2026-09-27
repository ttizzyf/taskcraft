import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type {
  CaseExecution,
  CaseSetup,
  EvalContext,
} from "../../core/types.ts";
import { recoveryCase } from "../../cases/recovery.ts";

function contextFor(): EvalContext {
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

function setupFor(workspace: string): CaseSetup {
  return {
    taskId: "T-1",
    workspace,
    requirement: "recover the task",
    modelCriteria: [],
    metadata: { variant: "empty" },
  };
}

describe("recovery grading without an established checkpoint", () => {
  it("never claims recovery was tested when the checkpoint is absent", async () => {
    const workspace = join(
      tmpdir(),
      `tc-eval-recovery-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(workspace, "src"), { recursive: true });

    try {
      const setup = setupFor(workspace);
      const execution: CaseExecution = {
        hostRuns: [],
        checkpoint: {
          established: false,
          initialSourceFiles: [],
          sourceFiles: [],
          taskStatus: null,
          attemptIds: [],
          capturedAt: new Date().toISOString(),
          reason: "no open attempt with changed source observed",
        },
      };
      const checks = await recoveryCase.grade(contextFor(), setup, execution, {
        snapshot: null,
        error: null,
      });
      const checkpointCheck = checks.find(
        (check) => check.id === "recovery-checkpoint",
      );
      expect(checkpointCheck?.verdict).toBe("inconclusive");
      expect(checkpointCheck?.reason).toContain("did not establish");
    } finally {
      // The workspace lives in the OS temp dir, so nothing else reclaims it.
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
