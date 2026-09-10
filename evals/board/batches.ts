import { formatTimeDisplay } from "./format.ts";

export interface BoardBatchSummary {
  id: string;
  status: string;
  createdAt: string;
  caseIds: string[];
  total: number;
  pass: number;
  fail: number;
  inconclusive: number;
  pending: number;
  running: number;
  diagnostics: string[];
}

export interface BoardBatchDisplay extends BoardBatchSummary {
  displayStatus: string;
  displayCreatedAt: string;
  displayCases: string;
  displayDiagnostics: string;
}

export function formatBatchStatus(status: string): string {
  switch (status) {
    case "pending":
      return "待运行";
    case "running":
      return "运行中";
    case "completed":
    case "complete":
    case "finished":
    case "done":
      return "已完成";
    case "cancelled":
    case "canceled":
      return "已取消";
    default:
      return status.trim() === "" ? "未知状态" : status;
  }
}

function formatBatchCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** Maps an already-decoded summary without owning batch file loading. */
export function formatBatchSummary(
  batch: BoardBatchSummary,
): BoardBatchDisplay {
  const pass = formatBatchCount(batch.pass);
  const fail = formatBatchCount(batch.fail);
  const inconclusive = formatBatchCount(batch.inconclusive);
  const pending = formatBatchCount(batch.pending);
  const running = formatBatchCount(batch.running);
  const caseIds = [...batch.caseIds];
  const diagnostics = [...batch.diagnostics];

  return {
    ...batch,
    caseIds,
    diagnostics,
    total: pass + fail + inconclusive + pending + running,
    pass,
    fail,
    inconclusive,
    pending,
    running,
    displayStatus: formatBatchStatus(batch.status),
    displayCreatedAt: formatTimeDisplay(batch.createdAt),
    displayCases: caseIds.length > 0 ? caseIds.join("、") : "无案例",
    displayDiagnostics:
      diagnostics.length > 0 ? diagnostics.join("；") : "无诊断",
  };
}

export function formatBatchSummaries(
  batches: readonly BoardBatchSummary[],
): BoardBatchDisplay[] {
  return batches.map((batch) => formatBatchSummary(batch));
}
