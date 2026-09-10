import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";

import type { CheckResult, CliExecution, TaskSnapshot } from "../core/types.ts";

export const CSV_VALID_INPUT =
  'name,amount\n"North, Inc.",2.5\n"Quote ""Co""",1\nPlain,3\nPlain,0.5\n';
export const CSV_EXPECTED = {
  rows: 4,
  totals: {
    "North, Inc.": 2.5,
    'Quote "Co"': 1,
    Plain: 3.5,
  },
};
export const CSV_INVALID_INPUT = "name,amount\nBroken,not-a-number\n";
export const CSV_MALFORMED_INPUT = "name,amount\nBroken,1,extra\n";

export const CSV_REQUIREMENTS = `
Implement a Node 24 CLI at src/csv-summary.mjs. It must read UTF-8 CSV from stdin with a required name,amount header, parse RFC 4180 quoted cells (including commas and escaped double quotes), and print JSON shaped exactly as {"rows": number, "totals": {"name": number}}. Sum repeated names and preserve decimal amounts. Malformed rows or non-numeric amounts must exit non-zero and write a useful message to stderr. Keep the implementation in the fixture project and use only Node built-ins.
`;

export function writeCsvReadme(
  workspace: string,
  variant: "empty" | "defect",
): void {
  mkdirSync(join(workspace, "src"), { recursive: true });
  const defect =
    variant === "defect"
      ? "\nThis sample is intentionally incomplete. Review its behavior against the contract; do not assume it is correct.\n"
      : "";
  writeFileSync(
    join(workspace, "README.md"),
    `# CSV summary fixture\n\n${CSV_REQUIREMENTS.trim()}\n${defect}`,
    "utf8",
  );
  writeFileSync(
    join(workspace, "package.json"),
    '{\n  "name": "taskcraft-eval-csv",\n  "private": true,\n  "type": "module"\n}\n',
    "utf8",
  );
}

export async function gradeCsvArtifact(
  workspace: string,
): Promise<CheckResult[]> {
  const artifact = join(workspace, "src", "csv-summary.mjs");
  try {
    await access(artifact);
  } catch {
    return [
      check(
        "csv-functional",
        "fail",
        "src/csv-summary.mjs is missing",
        "the required artifact path does not exist",
      ),
    ];
  }

  const valid = await runCsv(workspace, CSV_VALID_INPUT);
  const functional =
    valid.status === 0 && valid.stderr.trim() === ""
      ? parseExpected(valid.stdout)
      : false;
  const checks = [
    check(
      "csv-functional",
      functional ? "pass" : "fail",
      functional
        ? "quoted CSV and repeated-name aggregation matched the contract"
        : "CSV output did not match the independent contract",
      `exit=${String(valid.status)} stdout=${brief(valid.stdout)} stderr=${brief(valid.stderr)}`,
    ),
  ];

  const invalid = await runCsv(workspace, CSV_INVALID_INPUT);
  checks.push(
    check(
      "csv-invalid-input",
      invalid.status !== null &&
        invalid.status !== 0 &&
        invalid.stderr.trim() !== ""
        ? "pass"
        : "fail",
      invalid.status !== null &&
        invalid.status !== 0 &&
        invalid.stderr.trim() !== ""
        ? "malformed numeric input was rejected with stderr"
        : "malformed numeric input was accepted, timed out, or produced no useful error",
      `exit=${String(invalid.status)} stderr=${brief(invalid.stderr)}`,
    ),
  );

  const malformed = await runCsv(workspace, CSV_MALFORMED_INPUT);
  checks.push(
    check(
      "csv-malformed-row",
      malformed.status !== null &&
        malformed.status !== 0 &&
        malformed.stderr.trim() !== ""
        ? "pass"
        : "fail",
      malformed.status !== null &&
        malformed.status !== 0 &&
        malformed.stderr.trim() !== ""
        ? "malformed row shape was rejected with stderr"
        : "malformed row shape was accepted, timed out, or produced no useful error",
      `exit=${String(malformed.status)} stderr=${brief(malformed.stderr)}`,
    ),
  );
  return checks;
}

export function gradeTaskContract(
  task: TaskSnapshot | null,
  taskError: string | null,
  factSubject: string,
): CheckResult[] {
  if (task === null) {
    return [
      check(
        "tc-record",
        "inconclusive",
        "could not read the Task Store through the public CLI",
        taskError ?? "tc task show returned no data",
      ),
    ];
  }
  const checks: CheckResult[] = [];
  checks.push(
    check(
      "tc-done",
      task.status === "done" ? "pass" : "fail",
      task.status === "done"
        ? "Taskcraft projected the task as done"
        : `Taskcraft projected status ${task.status}, not done`,
      `task=${task.taskId} revision=${String(task.taskRevision)}`,
    ),
  );
  const executeAttempt = task.attempts.find(
    (attempt) =>
      attempt.nodeId === "execute-1" &&
      attempt.status === "finished" &&
      attempt.outcome === "success",
  );
  checks.push(
    check(
      "tc-execute-attempt",
      executeAttempt === undefined ? "fail" : "pass",
      executeAttempt === undefined
        ? "no successful finished execute attempt was recorded"
        : "a successful execute attempt is recorded",
      executeAttempt === undefined
        ? "attempts did not contain the required row"
        : String(executeAttempt.id),
    ),
  );
  const validation = task.evidence.find(
    (evidence) => evidence.type === "validation",
  );
  checks.push(
    check(
      "tc-validation-evidence",
      validation === undefined ? "fail" : "pass",
      validation === undefined
        ? "no validation evidence was recorded"
        : "validation evidence is linked in the Task Store",
      validation === undefined
        ? "evidence type validation was absent"
        : String(validation.id),
    ),
  );
  checks.push(gradeFact(task, factSubject, "tc-required-fact"));
  return checks;
}

export function gradeFact(
  task: TaskSnapshot | null,
  factSubject: string,
  id = "tc-required-fact",
): CheckResult {
  const fact = task?.facts.find(
    (candidate) => candidate.subject === factSubject,
  );
  return check(
    id,
    fact === undefined ? "fail" : "pass",
    fact === undefined
      ? `required task fact ${factSubject} was not recorded`
      : `task fact ${factSubject} is present`,
    fact === undefined
      ? "facts did not contain the required subject"
      : String(fact.id),
  );
}

async function runCsv(workspace: string, input: string): Promise<CliExecution> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join("src", "csv-summary.mjs")], {
      cwd: workspace,
      shell: false,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2_000).unref();
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status: null,
        stdout,
        stderr: `${stderr}${describe(error)}`,
        elapsedMs: Date.now() - started,
      });
    });
    child.on("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr, elapsedMs: Date.now() - started });
    });
    child.stdin.end(input);
  });
}

function parseExpected(output: string): boolean {
  try {
    const value = JSON.parse(output) as unknown;
    if (!isRecord(value) || value.rows !== CSV_EXPECTED.rows) return false;
    const totals = value.totals;
    if (!isRecord(totals)) return false;
    const expected = CSV_EXPECTED.totals;
    const keys = Object.keys(totals);
    if (keys.length !== Object.keys(expected).length) return false;
    return Object.entries(expected).every(
      ([name, amount]) => totals[name] === amount,
    );
  } catch {
    return false;
  }
}

function check(
  id: string,
  verdict: CheckResult["verdict"],
  reason: string,
  evidence: string,
): CheckResult {
  return { id, grader: "code", verdict, reason, evidence: [evidence] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function brief(value: string): string {
  return JSON.stringify(value.length > 300 ? `${value.slice(0, 300)}…` : value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
