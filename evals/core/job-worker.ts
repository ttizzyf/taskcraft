import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { writeJsonAtomic } from "../reporting/batch.ts";
import { runEval } from "./runner.ts";
import {
  JOB_PROTOCOL,
  JOB_RESULT_FILE,
  killProcessTree,
  type JobResultPayload,
  type JobWorkerRequest,
} from "./job.ts";

async function workerMain(): Promise<void> {
  let request: JobWorkerRequest;
  try {
    request = parseWorkerRequest(JSON.parse(await readStdin()) as unknown);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(invalidRequestResult(error))}\n`);
    return;
  }

  let terminationRequested = false;
  const terminate = (): void => {
    if (terminationRequested) return;
    terminationRequested = true;
    killProcessTree(process.pid, "SIGTERM");
    setTimeout(() => process.exit(143), 100).unref();
  };
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);

  process.chdir(request.repoRoot);
  let payload: JobResultPayload;
  try {
    const result = await runEval({
      caseId: request.caseId,
      list: false,
      actorTimeoutMs: request.actorTimeoutMs,
      judgeTimeoutMs: request.judgeTimeoutMs,
      host: request.host,
      cliPath: request.cliPath,
      runDir: request.attemptDir,
      ...(request.model === null ? {} : { model: request.model }),
      ...(request.judgeModel === null
        ? {}
        : { judgeModel: request.judgeModel }),
    });
    payload = {
      protocol: JOB_PROTOCOL,
      jobId: request.jobId,
      attempt: request.attempt,
      status: "finished",
      verdict: result.report.verdict,
      report: {
        jsonPath: result.jsonPath,
        markdownPath: result.markdownPath,
      },
      diagnostics: [],
    };
  } catch (error) {
    payload = {
      protocol: JOB_PROTOCOL,
      jobId: request.jobId,
      attempt: request.attempt,
      status: "error",
      verdict: null,
      report: null,
      diagnostics: [describe(error)],
    };
  }
  writeJsonAtomic(join(request.attemptDir, JOB_RESULT_FILE), payload);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function parseWorkerRequest(value: unknown): JobWorkerRequest {
  if (!isRecord(value) || value.protocol !== JOB_PROTOCOL) {
    throw new Error("invalid job worker request protocol");
  }
  const strings = [
    "jobId",
    "caseId",
    "attemptDir",
    "cliPath",
    "repoRoot",
  ] as const;
  for (const field of strings) {
    if (typeof value[field] !== "string" || value[field].trim() === "") {
      throw new Error(`job worker request ${field} is required`);
    }
  }
  if (value.host !== "claude" && value.host !== "pi-sdk") {
    throw new Error("job worker request host is invalid");
  }
  for (const field of [
    "repetition",
    "attempt",
    "actorTimeoutMs",
    "judgeTimeoutMs",
  ] as const) {
    if (!Number.isSafeInteger(value[field]) || Number(value[field]) <= 0) {
      throw new Error(`job worker request ${field} must be a positive integer`);
    }
  }
  if (value.model !== null && typeof value.model !== "string") {
    throw new Error("job worker request model must be a string or null");
  }
  if (value.judgeModel !== null && typeof value.judgeModel !== "string") {
    throw new Error("job worker request judgeModel must be a string or null");
  }
  return value as unknown as JobWorkerRequest;
}

function invalidRequestResult(error: unknown): JobResultPayload {
  return {
    protocol: JOB_PROTOCOL,
    jobId: "invalid",
    attempt: 1,
    status: "error",
    verdict: null,
    report: null,
    diagnostics: [describe(error)],
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await workerMain();
}
