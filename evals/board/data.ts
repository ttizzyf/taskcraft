import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CASES } from "../cases/index.ts";
import { isLoadableReport } from "./report.ts";
import {
  formatBatchSummaries,
  type BoardBatchDisplay,
  type BoardBatchSummary,
} from "./batches.ts";
import { formatTimeDisplay } from "./format.ts";
import { getScenarioGuide } from "./guide.ts";
import type { ScenarioGuide } from "./guide.ts";
import {
  computeReportComparison,
  isExecutionEstablished,
} from "./comparison.ts";
import type { ComparisonStatus, ReportComparisonResult } from "./comparison.ts";
import type { ActorSession, CheckResult, EvalReport } from "../core/types.ts";

export {
  computeCheckComparison,
  computeReportComparison,
  isExecutionEstablished,
} from "./comparison.ts";
export {
  formatBatchStatus,
  formatBatchSummary,
  formatBatchSummaries,
} from "./batches.ts";
export { formatTimeDisplay } from "./format.ts";
export type { BoardBatchDisplay, BoardBatchSummary } from "./batches.ts";
export type { ComparisonStatus, ReportComparisonResult };

export interface BoardOverview {
  totalScenarios: number;
  attemptedScenarios: number;
  decisiveScenarios: number;
  inconclusiveScenarios: number;
  blockedScenarios: number;
  unrunScenarios: number;
  lastUpdated: string | null;
}

export interface ScenarioRowData {
  id: string;
  chineseTitle: string;
  description: string;
  guide: ScenarioGuide | null;
  status: "pass" | "fail" | "blocked" | "inconclusive" | "unrun";
  displayStatus: string;
  runCount: number;
  oneLineReason: string;
  comparisonText: string;
  displayTime: string;
  displayElapsed: string;
  latestRun: FormattedReport | null;
}

export interface FormattedCheck {
  id: string;
  grader: string;
  verdict: string;
  displayVerdict: string;
  reason: string;
  rawReason: string;
  isDerivedInconclusive: boolean;
}

export interface FormattedActorSession {
  phase: string;
  status: string;
  displayStatus: string;
  elapsedMs: number;
  displayElapsed: string;
  diagnostics: string[];
  hasUnrecognizedModelWarning: boolean;
}

export interface FormattedReport {
  id: string;
  caseId: string;
  verdict: string;
  displayVerdict: string;
  isBlocked: boolean;
  isEstablished: boolean;
  oneLineReason: string;
  startedAt: string;
  finishedAt: string;
  displayTime: string;
  displayElapsed: string;
  comparison: ReportComparisonResult;
  conditionsDisplay: {
    actorModel: string;
    judgeModel: string;
    actorTimeout: string;
    judgeTimeout: string;
    hostVersion: string;
    subjectRevision: string;
  };
  checks: FormattedCheck[];
  actorSessions: FormattedActorSession[];
  rawReport: EvalReport;
}

export interface BoardPayload {
  overview: BoardOverview;
  scenarios: ScenarioRowData[];
  reports: FormattedReport[];
  batches?: BoardBatchDisplay[];
  malformedDiagnostics?: Array<{ filename: string; error: string }>;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = (ms / 1000).toFixed(1);
  return `${sec}秒`;
}

function checkHasUnrecognizedModelWarning(session: ActorSession): boolean {
  return session.diagnostics.some((d: string) =>
    d.includes("unrecognized_model"),
  );
}

export function formatCheck(
  check: CheckResult,
  executionEstablished: boolean,
): FormattedCheck {
  if (!executionEstablished) {
    return {
      id: check.id,
      grader: check.grader,
      verdict: "inconclusive",
      displayVerdict: "无法判定",
      reason: "无法判定：前置执行未完成",
      rawReason: check.reason,
      isDerivedInconclusive: true,
    };
  }

  let displayVerdict = "无法判定";
  if (check.verdict === "pass") displayVerdict = "通过";
  else if (check.verdict === "fail") displayVerdict = "未通过";
  else if (check.verdict === "inconclusive") displayVerdict = "无法判定";

  return {
    id: check.id,
    grader: check.grader,
    verdict: check.verdict,
    displayVerdict,
    reason: check.reason,
    rawReason: check.reason,
    isDerivedInconclusive: false,
  };
}

export function formatReport(
  report: EvalReport,
  priorReport: EvalReport | null,
): FormattedReport {
  const established = isExecutionEstablished(report);
  const isBlocked = !established;

  let displayVerdict = "无法判定";
  let oneLineReason = report.summary || "无摘要信息";

  if (isBlocked) {
    displayVerdict = "执行受阻";
    oneLineReason = "执行未完成，尚无可验收结果";
  } else if (report.verdict === "pass") {
    displayVerdict = "通过";
  } else if (report.verdict === "fail") {
    displayVerdict = "未通过";
  }

  const started = new Date(report.startedAt).getTime();
  const finished = new Date(report.finishedAt).getTime();
  const elapsedMs = Math.max(0, finished - started);

  const actorSessions: FormattedActorSession[] = report.actor.map((session) => {
    let displayStatus = "完成";
    if (session.status === "timeout") displayStatus = "超时";
    else if (session.status !== "success") displayStatus = "失败";

    return {
      phase: session.phase,
      status: session.status,
      displayStatus,
      elapsedMs: session.elapsedMs,
      displayElapsed: formatDurationMs(session.elapsedMs),
      diagnostics: session.diagnostics,
      hasUnrecognizedModelWarning: checkHasUnrecognizedModelWarning(session),
    };
  });

  const formattedChecks = report.checks.map((c) => formatCheck(c, established));

  const comparison = computeReportComparison(report, priorReport);

  const actorModel =
    report.provenance?.actorModel ?? report.environment.model ?? "未指定";
  const judgeModel =
    report.provenance?.judgeModel ?? report.environment.judgeModel ?? "未指定";
  const actorTimeout = report.provenance?.actorTimeoutMs
    ? formatDurationMs(report.provenance.actorTimeoutMs)
    : "默认180秒";
  const judgeTimeout = report.provenance?.judgeTimeoutMs
    ? formatDurationMs(report.provenance.judgeTimeoutMs)
    : "默认60秒";
  const hostVersion =
    report.provenance?.hostVersion ?? report.environment.host ?? "未知";
  const subjectRevision = report.provenance?.subjectRevision
    ? report.provenance.subjectRevision.slice(0, 8)
    : "未知";

  const runId = `${report.caseId}-${report.startedAt}`;

  return {
    id: runId,
    caseId: report.caseId,
    verdict: isBlocked ? "blocked" : report.verdict,
    displayVerdict,
    isBlocked,
    isEstablished: established,
    oneLineReason,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    displayTime: formatTimeDisplay(report.startedAt),
    displayElapsed: formatDurationMs(elapsedMs),
    comparison,
    conditionsDisplay: {
      actorModel,
      judgeModel,
      actorTimeout,
      judgeTimeout,
      hostVersion,
      subjectRevision,
    },
    checks: formattedChecks,
    actorSessions,
    rawReport: report,
  };
}

export function formatBoardData(
  reports: EvalReport[],
  diagnostics: Array<{ filename: string; error: string }> = [],
  batches?: readonly BoardBatchSummary[],
): BoardPayload {
  const sortedReports = [...reports].sort((a, b) => {
    return (
      new Date(b.startedAt || 0).getTime() -
      new Date(a.startedAt || 0).getTime()
    );
  });

  const reportsByCase = new Map<string, EvalReport[]>();
  for (const report of sortedReports) {
    const list = reportsByCase.get(report.caseId) ?? [];
    list.push(report);
    reportsByCase.set(report.caseId, list);
  }

  const formattedReports: FormattedReport[] = [];
  for (const [, list] of reportsByCase.entries()) {
    for (let i = 0; i < list.length; i += 1) {
      const cur = list[i]!;
      const prior = i + 1 < list.length ? (list[i + 1] ?? null) : null;
      formattedReports.push(formatReport(cur, prior));
    }
  }

  formattedReports.sort((a, b) => {
    return (
      new Date(b.startedAt || 0).getTime() -
      new Date(a.startedAt || 0).getTime()
    );
  });

  let attemptedScenarios = 0;
  let decisiveScenarios = 0;
  let inconclusiveScenarios = 0;
  let blockedScenarios = 0;
  let unrunScenarios = 0;

  const scenarios: ScenarioRowData[] = CASES.map((caseDef) => {
    const guide = getScenarioGuide(caseDef.id);
    const base = {
      id: caseDef.id,
      chineseTitle: guide?.title ?? caseDef.title,
      description: guide?.summary ?? caseDef.description,
      guide,
    };

    const caseRuns = formattedReports.filter((r) => r.caseId === caseDef.id);
    const latestRun = caseRuns.length > 0 ? caseRuns[0] : null;

    if (!latestRun) {
      unrunScenarios += 1;
      return {
        ...base,
        status: "unrun",
        displayStatus: "未运行",
        runCount: 0,
        oneLineReason: "尚未执行评测",
        comparisonText: "—",
        displayTime: "—",
        displayElapsed: "—",
        latestRun: null,
      };
    }

    attemptedScenarios += 1;

    if (latestRun.isBlocked) {
      blockedScenarios += 1;
      return {
        ...base,
        status: "blocked",
        displayStatus: "执行受阻",
        runCount: caseRuns.length,
        oneLineReason: latestRun.oneLineReason,
        comparisonText: latestRun.comparison.displayText,
        displayTime: latestRun.displayTime,
        displayElapsed: latestRun.displayElapsed,
        latestRun,
      };
    }

    if (latestRun.verdict === "inconclusive") {
      inconclusiveScenarios += 1;
      return {
        ...base,
        status: "inconclusive",
        displayStatus: "无法判定",
        runCount: caseRuns.length,
        oneLineReason: latestRun.oneLineReason,
        comparisonText: latestRun.comparison.displayText,
        displayTime: latestRun.displayTime,
        displayElapsed: latestRun.displayElapsed,
        latestRun,
      };
    }

    decisiveScenarios += 1;
    return {
      ...base,
      status: latestRun.verdict as "pass" | "fail" | "inconclusive",
      displayStatus: latestRun.displayVerdict,
      runCount: caseRuns.length,
      oneLineReason: latestRun.oneLineReason,
      comparisonText: latestRun.comparison.displayText,
      displayTime: latestRun.displayTime,
      displayElapsed: latestRun.displayElapsed,
      latestRun,
    };
  });

  const lastUpdated =
    sortedReports.length > 0 ? (sortedReports[0]?.startedAt ?? null) : null;

  const overview: BoardOverview = {
    totalScenarios: CASES.length,
    attemptedScenarios,
    decisiveScenarios,
    inconclusiveScenarios,
    blockedScenarios,
    unrunScenarios,
    lastUpdated,
  };

  const payload: BoardPayload = {
    overview,
    scenarios,
    reports: formattedReports,
    malformedDiagnostics: diagnostics,
  };
  if (batches !== undefined) {
    payload.batches = formatBatchSummaries(batches);
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadBoardData(runDir: string): BoardPayload {
  const diagnostics: Array<{ filename: string; error: string }> = [];
  const reports: EvalReport[] = [];

  if (!existsSync(runDir)) {
    return formatBoardData([], diagnostics);
  }

  const entries = readdirSync(runDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      const fullPath = join(runDir, entry.name);
      try {
        const raw = readFileSync(fullPath, "utf8");
        const parsed = JSON.parse(raw);
        if (
          !isRecord(parsed) ||
          parsed.schemaVersion !== "tc-eval/v1" ||
          !isLoadableReport(parsed)
        ) {
          diagnostics.push({
            filename: entry.name,
            error:
              "缺少必要的 schemaVersion 'tc-eval/v1'、caseId，或 checks/actor/environment 字段缺失、类型不符",
          });
          continue;
        }
        reports.push(parsed);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        diagnostics.push({ filename: entry.name, error: msg });
      }
    }
  }

  return formatBoardData(reports, diagnostics);
}
