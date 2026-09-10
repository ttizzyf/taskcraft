import type { EvalContext, CaseSetup, CliExecution } from "../core/types.ts";
import { installTcWrapper, writeText } from "../core/workspace.ts";
import { CSV_REQUIREMENTS, writeCsvReadme } from "./csv.ts";

export async function prepareCsvTask(
  context: EvalContext,
  workspace: string,
  title: string,
  variant: "empty" | "defect",
  facts: Record<string, unknown>,
): Promise<CaseSetup> {
  writeCsvReadme(workspace, variant);
  installTcWrapper(workspace, context.cliPath);
  requireSuccess(await context.runTc(workspace, ["init"]), "tc init");
  const created = requireSuccess(
    await context.runTc(workspace, [
      "task",
      "new",
      "--title",
      title,
      "--level",
      "1",
      "--reason",
      "eval fixture",
      "--facts",
      JSON.stringify(facts),
      "--json",
    ]),
    "tc task new",
  );
  const taskId = taskIdFrom(created.stdout);
  return {
    taskId,
    workspace,
    requirement: CSV_REQUIREMENTS.trim(),
    modelCriteria: [],
    metadata: { variant, initialTaskRevision: 1 },
  };
}

export function writeDefectArtifact(workspace: string): void {
  writeText(
    workspace,
    "src/csv-summary.mjs",
    `import { readFileSync } from "node:fs";

const lines = readFileSync(0, "utf8").trim().split(/\\r?\\n/);
const [header, ...rows] = lines;
if (header !== "name,amount") throw new Error("expected name,amount header");
const totals = {};
for (const row of rows) {
  const [name, amountText] = row.split(",");
  const amount = Number(amountText);
  if (!Number.isFinite(amount)) throw new Error("amount must be numeric");
  totals[name] = (totals[name] ?? 0) + amount;
}
process.stdout.write(JSON.stringify({ rows: rows.length, totals }) + "\\n");
`,
  );
}

export function actorPrompt(
  setup: CaseSetup,
  factSubject: string,
  extra: string,
  claimAttempt = true,
): string {
  const claim = claimAttempt
    ? `Start by claiming the task with: tc run ${setup.taskId} --node execute-1 --json.`
    : `An execute attempt for ${setup.taskId} is already open in durable tc state; inspect that state and continue the existing attempt without claiming a second one.`;
  return `You are the implementation actor for a Taskcraft evaluation. Work only in the current fixture directory. Treat README.md as the public contract and inspect existing files before changing them.

${setup.requirement}

Use the public tc CLI throughout the task. ${claim} Run independent checks using Node built-ins against your artifact and keep fixing until they pass.

Recording mechanics:
1. Read the current execute attempt id from: tc task show ${setup.taskId} --json (find the attempt whose nodeId is execute-1).
2. To append the required task fact (subject: ${factSubject}), first write the JSON value to ./facts.json with the Write/Edit tool, then run: tc task fact add ${setup.taskId} --attempt <attempt-id> --category <category> --subject ${factSubject} --value @./facts.json --json
   where <category> is exactly one of: intent, probe, constraint, assumption, dependency, environment.
3. Before completing, write the completion JSON to ./result.json with the Write/Edit tool. The execute node result schema is printed by the claim/attach command; it requires a non-empty summary, evidence entries with type/reference/summary, and a record whose specImpact uses outcome "none" with a non-empty reason. Then run: tc run complete ${setup.taskId} --result @./result.json --json

Do not claim success or mark the attempt complete before the independent checks pass and the evidence is recorded. Keep all changes inside the fixture workspace.

${extra}
`;
}

export function requireSuccess(
  result: CliExecution,
  operation: string,
): CliExecution {
  if (result.status !== 0) {
    throw new Error(
      `${operation} failed (exit ${String(result.status)}): ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

function taskIdFrom(stdout: string): string {
  const envelope = JSON.parse(stdout) as {
    ok?: boolean;
    data?: { taskId?: unknown };
  };
  const taskId = envelope.data?.taskId;
  if (envelope.ok !== true || typeof taskId !== "string") {
    throw new Error("tc task new returned no task id");
  }
  return taskId;
}
