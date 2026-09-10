import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { aggregate } from "../../core/runner.ts";
import { readTaskSnapshot, runTcCommand } from "../../core/tc.ts";
import type {
  CaseSetup,
  EvalContext,
  HostRun,
  HostRunRequest,
  TaskReadResult,
} from "../../core/types.ts";
import { gradeCsvArtifact } from "../../cases/csv.ts";
import { l2ReviewCase } from "../../cases/l2-review.ts";

const cliPath = join(process.cwd(), "dist", "cli.js");
const temporaryDirectories: string[] = [];

const CORRECT_CSV = `import { readFileSync } from "node:fs";

const lines = readFileSync(0, "utf8").split(/\\r?\\n/).filter((line) => line.trim() !== "");
if (lines[0]?.trim() !== "name,amount") {
  process.stderr.write("expected name,amount header\\n");
  process.exit(1);
}
const totals = {};
let rows = 0;
for (const line of lines.slice(1)) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  fields.push(current);
  if (quoted || fields.length !== 2 || fields[0]?.trim() === "") {
    process.stderr.write("malformed row\\n");
    process.exit(1);
  }
  const amount = Number(fields[1]?.trim());
  if (!Number.isFinite(amount)) {
    process.stderr.write("amount must be numeric\\n");
    process.exit(1);
  }
  totals[fields[0]] = (totals[fields[0]] ?? 0) + amount;
  rows += 1;
}
process.stdout.write(JSON.stringify({ rows, totals }) + "\\n");
`;

function workspace(): string {
  const value = join(
    tmpdir(),
    `tc-eval-l2-review-${Math.random().toString(36).slice(2)}`,
  );
  temporaryDirectories.push(value);
  mkdirSync(value, { recursive: true });
  return value;
}

function command(cwd: string, args: readonly string[]) {
  return runTcCommand(cliPath, cwd, args);
}

function successfulHost(phase: string): HostRun {
  return {
    phase,
    status: "success",
    exitCode: 0,
    signal: null,
    elapsedMs: 1,
    callCount: 1,
    resultText: null,
    diagnostics: [],
  };
}

function fakeContext(
  host: (request: HostRunRequest, phase: string) => Promise<HostRun>,
): EvalContext {
  return {
    repoRoot: process.cwd(),
    cliPath,
    runTc: (cwd, args, input) => runTcCommand(cliPath, cwd, args, input),
    readTask: (cwd, taskId) => readTaskSnapshot(cliPath, cwd, taskId),
    hashSources: async () => [],
    host: { run: host },
  };
}

function checkSuccess(result: Awaited<ReturnType<typeof command>>): void {
  expect(result.status).toBe(0);
}

function attemptId(
  task: TaskReadResult,
  nodeId: string,
  status: string,
): string {
  const attempt = task.snapshot?.attempts.find(
    (candidate) => candidate.nodeId === nodeId && candidate.status === status,
  );
  expect(attempt?.id).toEqual(expect.any(String));
  return attempt!.id as string;
}

async function repairThroughCli(
  request: HostRunRequest,
  setup: CaseSetup,
): Promise<HostRun> {
  const state = await readTaskSnapshot(cliPath, request.cwd, setup.taskId);
  const successor = attemptId(state, "execute-1", "created");
  writeFileSync(join(request.cwd, "src", "csv-summary.mjs"), CORRECT_CSV);
  writeFileSync(
    join(request.cwd, "facts.json"),
    JSON.stringify({
      source: "fake-independent-repair",
      checks: "csv contract",
    }),
    "utf8",
  );
  checkSuccess(
    await command(request.cwd, [
      "run",
      setup.taskId,
      "--node",
      "execute-1",
      "--json",
    ]),
  );
  checkSuccess(
    await command(request.cwd, [
      "task",
      "fact",
      "add",
      setup.taskId,
      "--attempt",
      successor,
      "--category",
      "environment",
      "--subject",
      "validation",
      "--value",
      "@./facts.json",
      "--json",
    ]),
  );
  writeFileSync(
    join(request.cwd, "result.json"),
    JSON.stringify({
      summary: "Repaired quoted CSV handling",
      evidence: [
        {
          type: "validation",
          reference: "ref://fake/csv",
          summary: "CSV contract passes",
        },
        {
          type: "test",
          reference: "ref://fake/tests",
          summary: "Invalid rows reject",
        },
      ],
    }),
    "utf8",
  );
  checkSuccess(
    await command(request.cwd, [
      "run",
      "complete",
      setup.taskId,
      "--result",
      "@./result.json",
      "--json",
    ]),
  );
  return successfulHost("l2-repair");
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.length = 0;
});

describe("l2-review case", () => {
  it("uses real tc CLI facts for changes, repair, re-review, and Record", async () => {
    const cwd = workspace();
    const holder: { setup?: CaseSetup } = {};
    const context = fakeContext(async (request, phase) => {
      expect(holder.setup).toBeDefined();
      if (phase === "l2-reviewer-initial") {
        const state = await readTaskSnapshot(
          cliPath,
          request.cwd,
          holder.setup!.taskId,
        );
        const review = attemptId(state, "review-1", "created");
        const reviewed = state.snapshot!.nodeBrief!.reviewContext;
        expect(reviewed).toEqual(
          expect.objectContaining({
            reviewedAttemptId: holder.setup!.metadata.initialExecuteAttemptId,
          }),
        );
        checkSuccess(
          await command(request.cwd, [
            "review",
            "changes",
            holder.setup!.taskId,
            "--attempt",
            review,
            "--reviewed-attempt",
            holder.setup!.metadata.initialExecuteAttemptId as string,
            "--finding",
            "Quoted names containing commas are split into multiple cells",
            "--json",
          ]),
        );
        return successfulHost(phase);
      }
      if (phase === "l2-repair")
        return repairThroughCli(request, holder.setup!);
      if (phase === "l2-reviewer-final") {
        const state = await readTaskSnapshot(
          cliPath,
          request.cwd,
          holder.setup!.taskId,
        );
        const review = attemptId(state, "review-1", "created");
        const reviewed = state.snapshot!.attempts.find(
          (candidate) =>
            candidate.nodeId === "execute-1" &&
            candidate.status === "finished" &&
            candidate.outcome === "success" &&
            candidate.id !== holder.setup!.metadata.initialExecuteAttemptId,
        );
        expect(reviewed?.id).toEqual(expect.any(String));
        writeFileSync(
          join(request.cwd, "review-evidence.json"),
          JSON.stringify({
            type: "validation",
            reference: "ref://fake/review",
            summary: "Independent reviewer reran all CSV boundary checks",
          }),
          "utf8",
        );
        checkSuccess(
          await command(request.cwd, [
            "review",
            "pass",
            holder.setup!.taskId,
            "--attempt",
            review,
            "--reviewed-attempt",
            reviewed!.id as string,
            "--evidence",
            "@./review-evidence.json",
            "--json",
          ]),
        );
        return successfulHost(phase);
      }
      throw new Error(`unexpected fake phase ${phase}`);
    });

    const setup = await l2ReviewCase.prepare(context, cwd);
    holder.setup = setup;
    const initialChecks = await gradeCsvArtifact(cwd);
    expect(
      initialChecks.find((check) => check.id === "csv-functional")?.verdict,
    ).toBe("fail");

    const execution = await l2ReviewCase.execute(
      context,
      setup,
      60_000,
      undefined,
    );
    const task = await context.readTask(cwd, setup.taskId);
    const checks = await l2ReviewCase.grade(context, setup, execution, task);
    expect(checks.filter((check) => check.verdict !== "pass")).toEqual([]);
    expect(task.snapshot?.status).toBe("done");
    expect(task.snapshot?.findings).toEqual([
      expect.objectContaining({
        severity: "blocking",
        disposition: "open",
        reviewAttemptId: execution.reviewTrace.firstReview.reviewAttemptId,
      }),
    ]);
    expect(execution.reviewTrace.finalTask?.snapshot?.status).toBe("done");
    expect(execution.judgeEvidence).toMatchObject({
      kind: "l2-review",
      reviewStarts: {
        first: {
          reviewAttemptId: execution.reviewTrace.firstReview.reviewAttemptId,
          reviewedAttemptId: execution.reviewTrace.initialExecuteAttemptId,
          capability: "context-only",
          independenceStatus: "unverified",
        },
        second: {
          reviewedAttemptId: execution.reviewTrace.successorExecuteAttemptId,
          capability: "context-only",
          independenceStatus: "unverified",
        },
      },
      stageReviewContexts: {
        first: expect.objectContaining({
          reviewedAttemptId: execution.reviewTrace.initialExecuteAttemptId,
        }),
        second: expect.objectContaining({
          reviewedAttemptId: execution.reviewTrace.successorExecuteAttemptId,
        }),
      },
      final: {
        status: "done",
        findings: expect.arrayContaining([
          expect.objectContaining({
            reviewAttemptId: execution.reviewTrace.firstReview.reviewAttemptId,
          }),
        ]),
      },
    });

    const unavailableChecks = await l2ReviewCase.grade(
      context,
      setup,
      execution,
      { snapshot: null, error: "final task show unavailable" },
    );
    expect(
      unavailableChecks.find((check) => check.id === "l2-task-done")?.verdict,
    ).toBe("inconclusive");
    expect(aggregate(execution.hostRuns, unavailableChecks).verdict).toBe(
      "inconclusive",
    );
  });

  it("does not pass when the reviewer omits the required changes_requested stage", async () => {
    const cwd = workspace();
    const holder: { setup?: CaseSetup } = {};
    const context = fakeContext(async (request, phase) => {
      expect(holder.setup).toBeDefined();
      if (phase !== "l2-reviewer-initial") throw new Error("unexpected phase");
      const state = await readTaskSnapshot(
        cliPath,
        request.cwd,
        holder.setup!.taskId,
      );
      const review = attemptId(state, "review-1", "created");
      checkSuccess(
        await command(request.cwd, [
          "review",
          "pass",
          holder.setup!.taskId,
          "--attempt",
          review,
          "--reviewed-attempt",
          holder.setup!.metadata.initialExecuteAttemptId as string,
          "--evidence",
          JSON.stringify({
            type: "note",
            reference: "ref://bad",
            summary: "accepted without checks",
          }),
          "--json",
        ]),
      );
      return successfulHost(phase);
    });

    const setup = await l2ReviewCase.prepare(context, cwd);
    holder.setup = setup;
    const execution = await l2ReviewCase.execute(
      context,
      setup,
      60_000,
      undefined,
    );
    const task = await context.readTask(cwd, setup.taskId);
    const checks = await l2ReviewCase.grade(context, setup, execution, task);
    expect(checks.find((check) => check.id === "csv-functional")?.verdict).toBe(
      "fail",
    );
    expect(
      checks.find((check) => check.id === "l2-changes-requested")?.verdict,
    ).toBe("fail");
    expect(
      checks.some(
        (check) => check.verdict === "pass" && check.id === "l2-record",
      ),
    ).toBe(false);
  });
});
