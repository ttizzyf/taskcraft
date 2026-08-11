import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TemporaryDirectory {
  path: string;
  cleanup(): void;
}

export function createTemporaryDirectory(): TemporaryDirectory {
  const path = mkdtempSync(join(tmpdir(), "taskcraft-"));

  return {
    path,
    cleanup: () => {
      rmSync(path, { recursive: true, force: true });
    },
  };
}
