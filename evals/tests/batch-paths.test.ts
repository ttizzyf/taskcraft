import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { batchDirectory } from "../reporting/batch-paths.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("batch path safety", () => {
  it("rejects a pre-created batch directory symlink", () => {
    const runDir = mkdtempSync(join(tmpdir(), "taskcraft-batch-path-"));
    roots.push(runDir);
    const batches = join(runDir, "batches");
    const outside = join(runDir, "outside");
    mkdirSync(batches);
    mkdirSync(outside);
    symlinkSync(outside, join(batches, "evil"));
    expect(() => batchDirectory(runDir, "evil")).toThrow("symlink");
    expect(existsSync(join(outside, "batch.json"))).toBe(false);
  });
});
