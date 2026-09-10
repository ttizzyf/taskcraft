import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { EvalReport } from "../core/types.ts";
import { isLoadableReport } from "./report.ts";

export function loadReports(
  runDir: string,
  diagnostics: Array<{ filename: string; error: string }>,
): EvalReport[] {
  const reports: EvalReport[] = [];
  if (!existsSync(runDir)) return reports;
  const entries = readdirSync(runDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const fullPath = join(runDir, entry.name);
    try {
      const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as unknown;
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
    } catch (error) {
      diagnostics.push({
        filename: entry.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return reports;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
