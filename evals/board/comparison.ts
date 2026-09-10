import { checkComparisonCompatibility } from "../reporting/provenance.ts";
import type { CheckResult, EvalReport } from "../core/types.ts";

export type ComparisonStatus =
  | "changed"
  | "inconclusive"
  | "unchanged"
  | "none"
  | "missing_metadata"
  | "condition_mismatch";

export interface CheckComparisonResult {
  id: string;
  previousVerdict: string | null;
  currentVerdict: string | null;
  status: "changed" | "inconclusive" | "unchanged" | "new" | "missing";
  displayText: string;
}

export interface ReportComparisonResult {
  status: ComparisonStatus;
  displayText: string;
  timingDeltaMs: number | null;
  displayTimingDelta: string | null;
  checkDeltas: CheckComparisonResult[];
}

export function formatTimingDelta(deltaMs: number): string {
  const seconds = (deltaMs / 1000).toFixed(1);
  if (deltaMs > 0) {
    return `+${seconds}秒`;
  }
  return `${seconds}秒`;
}

function verdictLabel(verdict: string | null): string {
  if (verdict === "pass") return "通过";
  if (verdict === "fail") return "未通过";
  if (verdict === "inconclusive") return "无法判定";
  if (verdict === null) return "未生成";
  return verdict;
}

function hasInconclusiveCheck(report: EvalReport): boolean {
  return (
    report.verdict === "inconclusive" ||
    report.checks.some((check) => check.verdict === "inconclusive")
  );
}

export function computeCheckComparison(
  currentChecks: CheckResult[],
  previousChecks: CheckResult[],
): CheckComparisonResult[] {
  const prevMap = new Map<string, CheckResult>();
  for (const check of previousChecks) {
    prevMap.set(check.id, check);
  }
  const currentIds = new Set(currentChecks.map((check) => check.id));

  const deltas: CheckComparisonResult[] = currentChecks.map((cur) => {
    const prev = prevMap.get(cur.id);
    if (!prev) {
      if (cur.verdict === "inconclusive") {
        return {
          id: cur.id,
          previousVerdict: null,
          currentVerdict: cur.verdict,
          status: "inconclusive" as const,
          displayText: "无法排序：未生成 → 无法判定",
        };
      }
      return {
        id: cur.id,
        previousVerdict: null,
        currentVerdict: cur.verdict,
        status: "new" as const,
        displayText: `新增检查项：${verdictLabel(cur.verdict)}`,
      };
    }

    if (cur.verdict === prev.verdict) {
      return {
        id: cur.id,
        previousVerdict: prev.verdict,
        currentVerdict: cur.verdict,
        status: "unchanged" as const,
        displayText: `结果未变化：${verdictLabel(cur.verdict)}`,
      };
    }

    if (cur.verdict === "inconclusive" || prev.verdict === "inconclusive") {
      return {
        id: cur.id,
        previousVerdict: prev.verdict,
        currentVerdict: cur.verdict,
        status: "inconclusive" as const,
        displayText: `无法排序：${verdictLabel(prev.verdict)} → ${verdictLabel(cur.verdict)}`,
      };
    }

    return {
      id: cur.id,
      previousVerdict: prev.verdict,
      currentVerdict: cur.verdict,
      status: "changed" as const,
      displayText: `结果变化：${verdictLabel(prev.verdict)} → ${verdictLabel(cur.verdict)}`,
    };
  });

  // Checks that disappeared from the current run stay visible as removed so a
  // dropped requirement never hides behind an otherwise equal comparison.
  for (const prev of previousChecks) {
    if (currentIds.has(prev.id)) continue;
    deltas.push({
      id: prev.id,
      previousVerdict: prev.verdict,
      currentVerdict: null,
      status: prev.verdict === "inconclusive" ? "inconclusive" : "missing",
      displayText:
        prev.verdict === "inconclusive"
          ? "无法排序：无法判定 → 未生成"
          : `本次运行已移除该检查项（上次：${verdictLabel(prev.verdict)}）`,
    });
  }

  return deltas;
}

/** True when at least one actor session actually completed successfully.
 *
 * Execution establishment is about whether the Actor ran to completion, not
 * about the aggregate verdict or grader health. Conflating them would label a
 * successful execution with a hard code failure as "执行受阻" merely because
 * the supplemental judge errored, erasing reliably obtained failure evidence.
 * Setup/execution errors therefore still count as not established only when
 * no session succeeded. */
export function isExecutionEstablished(report: EvalReport): boolean {
  return report.actor.some((session) => session.status === "success");
}

export function computeReportComparison(
  current: EvalReport,
  previous: EvalReport | null,
): ReportComparisonResult {
  if (!previous) {
    return {
      status: "none",
      displayText: "暂无可比历史",
      timingDeltaMs: null,
      displayTimingDelta: null,
      checkDeltas: [],
    };
  }

  const compat = checkComparisonCompatibility(current, previous);
  if (!compat.comparable) {
    const text =
      compat.reason === "missing_metadata"
        ? "缺少可比元数据"
        : "评测条件不一致，不可比";
    return {
      status: compat.reason,
      displayText: text,
      timingDeltaMs: null,
      displayTimingDelta: null,
      checkDeltas: [],
    };
  }

  const currentEstablished = isExecutionEstablished(current);
  const prevEstablished = isExecutionEstablished(previous);

  // Inconclusive / blocked trials NEVER manufacture ordering claims.
  if (!currentEstablished || !prevEstablished) {
    return {
      status: "inconclusive",
      displayText: "前置受阻，无有效判定比对",
      timingDeltaMs: null,
      displayTimingDelta: null,
      checkDeltas: [],
    };
  }

  const checkDeltas = computeCheckComparison(current.checks, previous.checks);
  if (hasInconclusiveCheck(current) || hasInconclusiveCheck(previous)) {
    return {
      status: "inconclusive",
      displayText: "含无法判定项，不排序",
      timingDeltaMs: null,
      displayTimingDelta: null,
      checkDeltas,
    };
  }

  const curDuration =
    new Date(current.finishedAt).getTime() -
    new Date(current.startedAt).getTime();
  const prevDuration =
    new Date(previous.finishedAt).getTime() -
    new Date(previous.startedAt).getTime();
  const timingDeltaMs = curDuration - prevDuration;
  const displayTimingDelta = formatTimingDelta(timingDeltaMs);

  if (current.verdict !== previous.verdict) {
    return {
      status: "changed",
      displayText: `结果变化：${verdictLabel(previous.verdict)} → ${verdictLabel(current.verdict)}`,
      timingDeltaMs,
      displayTimingDelta,
      checkDeltas,
    };
  }

  return {
    status: "unchanged",
    displayText: `结果未变化：${verdictLabel(current.verdict)}`,
    timingDeltaMs,
    displayTimingDelta,
    checkDeltas,
  };
}
