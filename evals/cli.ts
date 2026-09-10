#!/usr/bin/env node

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Command, InvalidArgumentError } from "commander";

import { CASES } from "./cases/index.ts";
import { runBatch, parseCaseIds } from "./core/batch.ts";
import { runEval } from "./core/runner.ts";
import { startBoardServer } from "./board/server.ts";
import type { HostAdapter } from "./core/types.ts";

export function createProgram(
  execute: typeof runEval = runEval,
  startServer: typeof startBoardServer = startBoardServer,
  executeBatch: typeof runBatch = runBatch,
): Command {
  return new Command()
    .name("eval")
    .description("run Taskcraft evals (five cases)")
    .option("--list", "list available cases and exit")
    .option("--case <id>", "run one case by id")
    .option("--all", "run all available cases as a batch")
    .option("--cases <ids>", "run comma-separated cases as a batch")
    .option("--repeat <count>", "repeat every selected case", positiveInt)
    .option(
      "--concurrency <count>",
      "maximum concurrent batch jobs",
      positiveInt,
    )
    .option("--resume <batch-id>", "resume an incomplete batch")
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
    .action(async (options, command) => {
      const optionSupplied = (name: string): boolean =>
        command.getOptionValueSource(name) === "cli";
      const batchRequested =
        options.all === true ||
        options.cases !== undefined ||
        options.repeat !== undefined ||
        options.concurrency !== undefined ||
        options.resume !== undefined;

      if (options.watch === true) {
        if (options.case !== undefined) {
          throw new InvalidArgumentError("--watch cannot be used with --case");
        }
        if (options.list === true) {
          throw new InvalidArgumentError("--watch cannot be used with --list");
        }
        if (batchRequested) {
          throw new InvalidArgumentError(
            "--watch cannot be used with batch execution",
          );
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

      if (options.list === true && batchRequested) {
        throw new InvalidArgumentError(
          "--list cannot be used with batch execution",
        );
      }
      if (options.list === true) {
        printCases();
        return;
      }
      if (batchRequested) {
        if (options.resume !== undefined) {
          if (
            options.case !== undefined ||
            options.all === true ||
            options.cases !== undefined ||
            optionSupplied("repeat") ||
            optionSupplied("concurrency") ||
            optionSupplied("model") ||
            optionSupplied("judgeModel") ||
            optionSupplied("agentHost") ||
            optionSupplied("actorTimeoutMs") ||
            optionSupplied("judgeTimeoutMs") ||
            optionSupplied("tc")
          ) {
            throw new InvalidArgumentError(
              "--resume cannot modify saved execution config",
            );
          }
          const result = await executeBatch({
            resumeBatchId: options.resume,
            ...(options.runDir === undefined
              ? {}
              : { runDir: resolve(options.runDir) }),
          });
          printBatchResult(result);
          return;
        }
        if (options.case !== undefined && options.all === true) {
          throw new InvalidArgumentError("--all cannot be used with --case");
        }
        if (options.case !== undefined && options.cases !== undefined) {
          throw new InvalidArgumentError("--cases cannot be used with --case");
        }
        if (options.all === true && options.cases !== undefined) {
          throw new InvalidArgumentError("--all cannot be used with --cases");
        }
        const caseIds =
          options.cases === undefined
            ? options.case === undefined
              ? CASES.map((candidate) => candidate.id)
              : [options.case]
            : parseCaseIdsForCli(options.cases);
        const result = await executeBatch({
          caseIds,
          actorTimeoutMs: options.actorTimeoutMs,
          judgeTimeoutMs: options.judgeTimeoutMs,
          ...(options.repeat === undefined ? {} : { repeat: options.repeat }),
          ...(options.concurrency === undefined
            ? {}
            : { concurrency: options.concurrency }),
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.judgeModel === undefined
            ? {}
            : { judgeModel: options.judgeModel }),
          ...(options.agentHost === undefined
            ? {}
            : { host: options.agentHost }),
          ...(options.tc === undefined ? {} : { cliPath: resolve(options.tc) }),
          ...(options.runDir === undefined
            ? {}
            : { runDir: resolve(options.runDir) }),
        });
        printBatchResult(result);
        return;
      }

      if (options.case === undefined) {
        printCases();
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

function printCases(): void {
  console.log("Available eval cases:");
  for (const candidate of CASES) {
    console.log(`  ${candidate.id}\t${candidate.title}`);
    console.log(`      ${candidate.description}`);
  }
}

function printBatchResult(result: Awaited<ReturnType<typeof runBatch>>): void {
  const counts = result.batch.jobs.reduce(
    (summary, job) => {
      summary[job.status] += 1;
      return summary;
    },
    { pending: 0, running: 0, pass: 0, fail: 0, inconclusive: 0 },
  );
  console.log(`batch ${result.batch.id}: ${result.batch.status}`);
  console.log(
    `jobs: total=${String(result.batch.jobs.length)} pass=${String(counts.pass)} fail=${String(counts.fail)} inconclusive=${String(counts.inconclusive)} pending=${String(counts.pending)} running=${String(counts.running)}`,
  );
  console.log(`json: ${result.batchPath}`);
}

function parseCaseIdsForCli(value: string): string[] {
  try {
    return parseCaseIds(value);
  } catch (error) {
    throw new InvalidArgumentError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function hostAdapterOption(value: string): HostAdapter {
  if (value === "claude" || value === "pi-sdk") return value;
  throw new InvalidArgumentError("must be claude or pi-sdk");
}

function positiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await createProgram().parseAsync();
}
