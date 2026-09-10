import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { EvalReport } from "../core/types.ts";

/** Persists one run's report as JSON (full record for review/diagnostics) and
 * a short human-readable Markdown summary. Both live under evals/runs which
 * is git-ignored; nothing here touches the product or task artifacts. */
export function writeReport(
  report: EvalReport,
  runDir: string,
  caseId: string,
): { jsonPath: string; markdownPath: string } {
  mkdirSync(runDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${caseId}-${stamp}`;
  const jsonPath = join(runDir, `${base}.json`);
  const markdownPath = join(runDir, `${base}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

export function renderMarkdown(report: EvalReport): string {
  const lines = [
    `# Eval: ${report.caseId} — ${report.title}`,
    "",
    `**Verdict:** ${report.verdict}`,
    `**Summary:** ${report.summary}`,
    "",
    `- schema: ${report.schemaVersion}`,
    `- ran: ${report.startedAt} → ${report.finishedAt}`,
    `- node: ${report.environment.node}`,
    `- host adapter: ${report.environment.hostAdapter ?? "legacy"}`,
    `- requested actor model: ${report.environment.model ?? "not specified"}`,
    `- requested judge model: ${report.environment.judgeModel ?? "not specified"}`,
    `- workspace: ${report.workspace}`,
    "",
    "## Actor sessions",
    ...(report.actor.length === 0
      ? ["(none)"]
      : report.actor.map(
          (run) =>
            `- ${run.phase}: ${run.status} in ${run.elapsedMs}ms` +
            (run.callCount === null
              ? ""
              : ` (${String(run.callCount)} calls)`) +
            (run.diagnostics.length === 0
              ? ""
              : ` — ${run.diagnostics.join("; ")}`) +
            (run.hostVersion === null ? "" : ` [host ${run.hostVersion}]`) +
            (run.model === null ? "" : ` [model ${run.model}]`) +
            (run.host == null ? "" : ` [adapter ${run.host}]`) +
            (run.requestedModel == null
              ? ""
              : ` [requested ${run.requestedModel}]`) +
            (run.observedApi == null ? "" : ` [api ${run.observedApi}]`) +
            (run.observedThinkingLevel == null
              ? ""
              : ` [thinking ${run.observedThinkingLevel}]`),
        )),
    "",
    "## Checks",
    ...(report.checks.length === 0
      ? ["(none)"]
      : report.checks.map(
          (check) =>
            `- \`${check.id}\` [${check.grader}] **${check.verdict}** — ${check.reason}`,
        )),
    "",
    `## Model grader: ${report.model.status}`,
    `\`\`\`json\n${JSON.stringify(
      {
        elapsedMs: report.model.elapsedMs,
        callCount: report.model.callCount,
        diagnostics: report.model.diagnostics,
        adapter: report.model.host,
        requestedModel: report.model.requestedModel,
        requestedThinkingLevel: report.model.requestedThinkingLevel,
        observedProvider: report.model.observedProvider,
        observedApi: report.model.observedApi,
        observedThinkingLevel: report.model.observedThinkingLevel,
      },
      null,
      2,
    )}\n\`\`\``,
    "",
    ...(report.checkpoint === undefined
      ? []
      : [
          "## Checkpoint",
          `- established: ${String(report.checkpoint.established)}`,
          `- reason: ${report.checkpoint.reason}`,
          `- captured at: ${report.checkpoint.capturedAt}`,
        ]),
    ...(report.taskReadError === null
      ? []
      : ["", `## Task read error`, report.taskReadError]),
    ...(report.setupError === null
      ? []
      : ["", "## Setup error", report.setupError]),
    ...(report.executionError === null
      ? []
      : ["", "## Execution error", report.executionError]),
    ...(report.gradingError === null
      ? []
      : ["", "## Code grading error", report.gradingError]),
    ...(report.graderError === null
      ? []
      : ["", "## Model grading error", report.graderError]),
    "",
  ];
  return lines.join("\n");
}
