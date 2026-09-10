import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createProgram } from "../cli.ts";
import type { runEval } from "../core/runner.ts";
import type { startBoardServer } from "../board/server.ts";

const STOP = new Error("captured options; do not launch a real model");
const STOP_SERVER = new Error("captured server launch; do not start server");

function harness() {
  const execute = vi.fn<typeof runEval>().mockRejectedValue(STOP);
  const startServer = vi
    .fn<typeof startBoardServer>()
    .mockRejectedValue(STOP_SERVER);
  const program = createProgram(execute, startServer)
    .exitOverride()
    .configureOutput({ writeErr: () => undefined });
  return { execute, startServer, program };
}

describe("eval CLI options", () => {
  it("passes explicit models, budgets and paths to the runner", async () => {
    const { execute, program } = harness();
    await expect(
      program.parseAsync(
        [
          "--case",
          "delivery",
          "--model",
          "actor-model",
          "--judge-model",
          "judge-model",
          "--actor-timeout-ms",
          "1234",
          "--judge-timeout-ms",
          "5678",
          "--run-dir",
          "evals/runs/custom",
          "--tc",
          "dist/cli.js",
        ],
        { from: "user" },
      ),
    ).rejects.toBe(STOP);
    expect(execute).toHaveBeenCalledWith({
      caseId: "delivery",
      list: false,
      model: "actor-model",
      judgeModel: "judge-model",
      actorTimeoutMs: 1234,
      judgeTimeoutMs: 5678,
      runDir: resolve("evals/runs/custom"),
      cliPath: resolve("dist/cli.js"),
    });
  });

  it("selects the Pi SDK adapter without consuming the board --host option", async () => {
    const { execute, program } = harness();
    await expect(
      program.parseAsync(
        [
          "--case",
          "delivery",
          "--agent-host",
          "pi-sdk",
          "--model",
          "company/gpt-5.6-luna:max",
          "--judge-model",
          "company/gpt-5.6-luna:max",
        ],
        { from: "user" },
      ),
    ).rejects.toBe(STOP);
    expect(execute).toHaveBeenCalledWith({
      caseId: "delivery",
      list: false,
      actorTimeoutMs: 180_000,
      judgeTimeoutMs: 60_000,
      model: "company/gpt-5.6-luna:max",
      judgeModel: "company/gpt-5.6-luna:max",
      host: "pi-sdk",
    });
  });

  it("rejects an unknown actor host adapter before execution", async () => {
    const { execute, program } = harness();
    await expect(
      program.parseAsync(["--case", "delivery", "--agent-host", "unknown"], {
        from: "user",
      }),
    ).rejects.toThrow("must be claude or pi-sdk");
    expect(execute).not.toHaveBeenCalled();
  });
  it("uses documented budgets when omitted", async () => {
    const { execute, program } = harness();
    await expect(
      program.parseAsync(["--case", "review"], { from: "user" }),
    ).rejects.toBe(STOP);
    expect(execute).toHaveBeenCalledWith({
      caseId: "review",
      list: false,
      actorTimeoutMs: 180_000,
      judgeTimeoutMs: 60_000,
    });
  });

  it.each(["0", "-1", "NaN", "1.5"])(
    "rejects invalid budget %s before execution",
    async (value) => {
      const { execute, program } = harness();
      await expect(
        program.parseAsync(
          ["--case", "delivery", "--actor-timeout-ms", value],
          { from: "user" },
        ),
      ).rejects.toThrow("positive integer");
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("launches board server when --watch is supplied", async () => {
    const { startServer, program } = harness();
    await expect(
      program.parseAsync(["--watch", "--port", "3200", "--host", "127.0.0.1"], {
        from: "user",
      }),
    ).rejects.toBe(STOP_SERVER);
    expect(startServer).toHaveBeenCalledWith({
      port: 3200,
      host: "127.0.0.1",
    });
  });

  it("rejects --watch combined with --case or --list", async () => {
    const { program } = harness();
    await expect(
      program.parseAsync(["--watch", "--case", "delivery"], { from: "user" }),
    ).rejects.toThrow("--watch cannot be used with --case");

    await expect(
      program.parseAsync(["--watch", "--list"], { from: "user" }),
    ).rejects.toThrow("--watch cannot be used with --list");
  });
});
