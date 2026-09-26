import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import type { GraderArtifact } from "./model.ts";

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".mjs",
  ".js",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".sh",
]);
const PER_FILE_LIMIT = 20_000;
const TOTAL_LIMIT = 200_000;

/** Collects text-like files in the isolated fixture as quoted text for the
 * model grader. Source files and project metadata are included so scope and
 * dependency claims can be checked; binary or oversized files are reported by
 * name only. Content is truncated with per-file and total budgets. */
export function collectArtifacts(workspace: string): GraderArtifact[] {
  const root = resolve(workspace);
  const artifacts: GraderArtifact[] = [];
  let total = 0;
  const files: string[] = [];
  collectFiles(root, files);
  files.sort();

  for (const file of files) {
    if (total >= TOTAL_LIMIT) {
      artifacts.push({
        path: relative(workspace, file),
        content: "(truncated: total artifact budget reached)",
      });
      continue;
    }
    const extension = extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) {
      artifacts.push({
        path: relative(workspace, file),
        content: "(skipped non-text artifact)",
      });
      continue;
    }
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      artifacts.push({
        path: relative(workspace, file),
        content: "(unreadable artifact)",
      });
      continue;
    }
    const sized =
      content.length > PER_FILE_LIMIT
        ? `${content.slice(0, PER_FILE_LIMIT)}\n…(truncated)`
        : content;
    total += sized.length;
    artifacts.push({ path: relative(workspace, file), content: sized });
  }
  return artifacts;
}

function collectFiles(directory: string, files: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collectFiles(path, files);
      continue;
    }
    files.push(path);
  }
}
