import { checkComparisonCompatibility } from "../reporting/provenance.ts";
import type { CheckResult, EvalReport } from "../core/types.ts";

export type ComparisonStatus =
  | "improved"
  | "regressed"
  | "unchanged"
  | "none"
  | "missing_metadata"
  | "condition_mismatch";

export interface CheckComparisonResult {
  id: string;
  previousVerdict: string | null;
  currentVerdict: string | null;
  status: "improved" | "regressed" | "unchanged" | "new" | "missing";
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

function getVerdictScore(verdict: string): number {
  if (verdict === "pass") return 2;
  if (verdict === "fail") return 1;
  return 0; // blocked, inconclusive, unrun, etc.
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
      return {
        id: cur.id,
        previousVerdict: null,
        currentVerdict: cur.verdict,
        status: "new" as const,
        displayText: "新增检查项",
      };
    }

    if (cur.verdict === prev.verdict) {
      return {
        id: cur.id,
        previousVerdict: prev.verdict,
        currentVerdict: cur.verdict,
        status: "unchanged" as const,
        displayText: "持平",
      };
    }

    if (cur.verdict === "pass" && prev.verdict === "fail") {
      return {
        id: cur.id,
        previousVerdict: prev.verdict,
        currentVerdict: cur.verdict,
        status: "improved" as const,
        displayText: "改善 (失败 → 通过)",
      };
    }

    if (cur.verdict === "fail" && prev.verdict === "pass") {
      return {
        id: cur.id,
        previousVerdict: prev.verdict,
        currentVerdict: cur.verdict,
        status: "regressed" as const,
        displayText: "退步 (通过 → 失败)",
      };
    }

    // Any other transition (e.g. pass <-> inconclusive) is not a proven
    // pass/fail change and must not masquerade as improvement or regression.
    return {
      id: cur.id,
      previousVerdict: prev.verdict,
      currentVerdict: cur.verdict,
      status: "unchanged" as const,
      displayText: `${prev.verdict} → ${cur.verdict}`,
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
      status: "missing",
      displayText: "本次运行已移除该检查项",
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

  // Inconclusive / blocked trials NEVER manufacture regressions or improvements
  if (!currentEstablished || !prevEstablished) {
    return {
      status: "unchanged",
      displayText: "前置受阻，无有效判定比对",
      timingDeltaMs: null,
      displayTimingDelta: null,
      checkDeltas: [],
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

  const checkDeltas = computeCheckComparison(current.checks, previous.checks);

  const curScore = getVerdictScore(current.verdict);
  const prevScore = getVerdictScore(previous.verdict);

  if (curScore > prevScore) {
    return {
      status: "improved",
      displayText: "改善",
      timingDeltaMs,
      displayTimingDelta,
      checkDeltas,
    };
  }

  if (curScore < prevScore) {
    return {
      status: "regressed",
      displayText: "退步",
      timingDeltaMs,
      displayTimingDelta,
      checkDeltas,
    };
  }

  return {
    status: "unchanged",
    displayText: "持平",
    timingDeltaMs,
    displayTimingDelta,
    checkDeltas,
  };
}
