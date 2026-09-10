#!/usr/bin/env node

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Command, InvalidArgumentError } from "commander";

import { CASES } from "./cases/index.ts";
import { runEval } from "./core/runner.ts";
import { startBoardServer } from "./board/server.ts";
import type { HostAdapter } from "./core/types.ts";

export function createProgram(
  execute: typeof runEval = runEval,
  startServer: typeof startBoardServer = startBoardServer,
): Command {
  return new Command()
    .name("eval")
    .description("run Taskcraft evals (delivery, recovery, review)")
    .option("--list", "list available cases and exit")
    .option("--case <id>", "run one case by id")
    .option("--watch", "launch standalone evals board server and watch reports")
    .option(
      "--port <port>",
      "board server port (default 3100)",
      positiveInt,
      3100,
    )
    .option(
      "--host <host>",
      "board server host (default 127.0.0.1)",
      "127.0.0.1",
    )
    .option(
      "--agent-host <adapter>",
      "actor/judge host adapter (claude or pi-sdk; default claude)",
      hostAdapterOption,
    )
    .option("--model <model>", "actor host model (defaults to host settings)")
    .option("--judge-model <model>", "model grader model")
    .option(
      "--actor-timeout-ms <ms>",
      "actor session budget",
      positiveInt,
      180_000,
    )
    .option(
      "--judge-timeout-ms <ms>",
      "judge session budget",
      positiveInt,
      60_000,
    )
    .option("--tc <path>", "path to the tc CLI (default dist/cli.js)")
    .option("--run-dir <dir>", "output directory (default evals/runs)")
    .action(async (options) => {
      if (options.watch === true) {
        if (options.case !== undefined) {
          throw new InvalidArgumentError("--watch cannot be used with --case");
        }
        if (options.list === true) {
          throw new InvalidArgumentError("--watch cannot be used with --list");
        }
        const serverHandle = await startServer({
          port: options.port,
          host: options.host,
          ...(options.runDir === undefined
            ? {}
            : { runDir: resolve(options.runDir) }),
        });
        console.log(`Taskcraft Evals 看板已启动: ${serverHandle.url}`);
        console.log(
          `报告目录: ${resolve(options.runDir ?? join(process.cwd(), "evals", "runs"))}`,
        );
        console.log("按 Ctrl+C 停止服务");

        await new Promise<void>((resolvePromise) => {
          const shutdown = async () => {
            await serverHandle.close();
            resolvePromise();
          };
          process.once("SIGINT", shutdown);
          process.once("SIGTERM", shutdown);
        });
        return;
      }

      if (options.list === true || options.case === undefined) {
        console.log("Available eval cases:");
        for (const candidate of CASES) {
          console.log(`  ${candidate.id}\t${candidate.title}`);
          console.log(`      ${candidate.description}`);
        }
        return;
      }
      const result = await execute({
        caseId: options.case,
        list: false,
        actorTimeoutMs: options.actorTimeoutMs,
        judgeTimeoutMs: options.judgeTimeoutMs,
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.judgeModel === undefined
          ? {}
          : { judgeModel: options.judgeModel }),
        ...(options.agentHost === undefined ? {} : { host: options.agentHost }),
        ...(options.tc === undefined ? {} : { cliPath: resolve(options.tc) }),
        ...(options.runDir === undefined
          ? {}
          : { runDir: resolve(options.runDir) }),
      });
      console.log(`eval ${result.report.caseId}: ${result.report.verdict}`);
      console.log(result.report.summary);
      console.log(`json: ${result.jsonPath}`);
      console.log(`markdown: ${result.markdownPath}`);
    });
}

function hostAdapterOption(value: string): HostAdapter {
  if (value === "claude" || value === "pi-sdk") return value;
  throw new InvalidArgumentError("must be claude or pi-sdk");
}

function positiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(
      "must be a positive integer in milliseconds",
    );
  }
  return parsed;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await createProgram().parseAsync();
}
