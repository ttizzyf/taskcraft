import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { isProcessAlive } from "../core/job.ts";
import { runBatch } from "../core/batch.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("batch cancellation cleanup", () => {
  it("waits for SIGTERM-ignoring detached descendants to exit", async () => {
    const root = mkdtempSync(join(tmpdir(), "taskcraft-batch-cancel-test-"));
    roots.push(root);
    const runDir = join(root, "runs");
    const workerPath = join(root, "worker.mjs");
    const markerPath = join(root, "descendant.pid");
    writeFileSync(workerPath, workerSource(markerPath), "utf8");
    chmodSync(workerPath, 0o755);

    const controller = new AbortController();
    const running = runBatch({
      runDir,
      caseIds: ["delivery"],
      workerPath,
      signal: controller.signal,
    });
    await waitFor(() => existsSync(markerPath));
    const pid = Number(readFileSync(markerPath, "utf8"));
    controller.abort();
    const result = await running;

    expect(result.batch.status).toBe("interrupted");
    await waitFor(() => !isProcessAlive(pid));
  });
});

function workerSource(markerPath: string): string {
  return `import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
writeFileSync(${JSON.stringify(markerPath)}, String(child.pid));
process.once("SIGTERM", () => process.exit(143));
setInterval(() => {}, 1000);
`;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for batch fixture");
}
