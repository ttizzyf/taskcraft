import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { EvalReport } from "../core/types.ts";
import { parseEvalReport } from "../reporting/report.ts";

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
      try {
        reports.push(parseEvalReport(parsed));
      } catch (error) {
        diagnostics.push({
          filename: entry.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      diagnostics.push({
        filename: entry.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return reports;
}
