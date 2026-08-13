// Stop gate decision matrix (pure decideStop) and the thin IO wrapper
// (runStopGate): waiting/done/cancelled tasks and active tasks without work
// are allowed to stop; an active task with runnable or running nodes blocks
// and prints the breadcrumb. off mode always allows with zero output.

import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import {
  decideStop,
  decideStopForHook,
  runStopGate,
} from "../../src/hooks/stop.js";
import { insertL1Fixture, insertNode, insertTask } from "../store/helpers.js";
import {
  activeProjection,
  createHookProject,
  createStoreAt,
  FIXED_TIMESTAMP,
  nonActiveProjection,
} from "./helpers.js";

describe("decideStop pure matrix", () => {
  it("allows when there is no task", () => {
    expect(decideStop(null)).toBe("allow");
  });

  it("allows non-active projections", () => {
    for (const status of ["waiting", "done", "cancelled", "queued"] as const) {
      expect(decideStop(nonActiveProjection(status))).toBe("allow");
    }
  });

  it("blocks an active task with a runnable node and names the next command", () => {
    const projection = activeProjection();

    expect(decideStop(projection)).toEqual({
      action: "block",
      next: "tc run T-1 --node execute-1",
    });
  });

  it("blocks an active task with a running node", () => {
    const projection = activeProjection({
      runnableNodes: [],
      runningNode: "execute-1",
      next: "tc run complete T-1",
    });

    expect(decideStop(projection)).toEqual({
      action: "block",
      next: "tc run complete T-1",
    });
  });

  it("allows an active task without runnable or running work", () => {
    const projection = activeProjection({
      runnableNodes: [],
      runningNode: null,
      next: null,
    });

    expect(decideStop(projection)).toBe("allow");
  });
});

describe("decideStopForHook loop guard", () => {
  it("releases the second stop of a turn even when work is runnable", () => {
    const projection = activeProjection();

    expect(decideStopForHook(true, projection)).toBe("allow");
  });

  it("still blocks the first stop of a turn with runnable work", () => {
    const projection = activeProjection();

    expect(decideStopForHook(false, projection)).toEqual({
      action: "block",
      next: "tc run T-1 --node execute-1",
    });
  });

  it("allows when the task is done regardless of the loop flag", () => {
    expect(decideStopForHook(false, nonActiveProjection("done"))).toBe("allow");
  });
});

describe("runStopGate IO wrapper", () => {
  it("off always allows with zero output, even with an active task", () => {
    const project = createHookProject({ takeOver: "off" }, true);
    const database = createStoreAt(project.databasePath);
    insertTask(database, { id: "T-1", activatedAt: FIXED_TIMESTAMP });
    insertNode(database, "T-1", "execute-1", "execute");
    database.close();

    try {
      const result = runStopGate(project.configPath);

      expect(result.decision).toBe("allow");
      expect(result.output).toBeNull();
    } finally {
      project.cleanup();
    }
  });

  it("a project without a Task Store allows the stop", () => {
    const project = createHookProject({ takeOver: "always" }, false);

    try {
      const result = runStopGate(project.configPath);

      expect(result.decision).toBe("allow");
      expect(result.output).toBeNull();
    } finally {
      project.cleanup();
    }
  });

  it("blocks an active task and prints the breadcrumb", () => {
    const project = createHookProject({ takeOver: "ask" }, true);
    const database = createStoreAt(project.databasePath);
    insertTask(database, { id: "T-1", activatedAt: FIXED_TIMESTAMP });
    insertNode(database, "T-1", "execute-1", "execute");
    database.close();

    try {
      const result = runStopGate(project.configPath);

      expect(result.decision).toEqual({
        action: "block",
        next: "tc run T-1 --node execute-1",
      });
      expect(result.output).toContain("tc-breadcrumb/v1");
    } finally {
      project.cleanup();
    }
  });

  it("a waiting task allows the stop", () => {
    const project = createHookProject({ takeOver: "always" }, true);
    const database = createStoreAt(project.databasePath);
    insertL1Fixture(database);
    database.close();

    try {
      const result = runStopGate(project.configPath);

      expect(result.decision).toBe("allow");
      expect(result.output).toBeNull();
    } finally {
      project.cleanup();
    }
  });

  it("maps a missing or malformed config to a stable diagnostic", () => {
    for (const config of ["not json", { takeOver: "bogus" }]) {
      const project = createHookProject(config, false);

      try {
        expect(() => runStopGate(project.configPath)).toThrowError(
          expect.objectContaining({
            code: ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED,
            remediation: expect.stringContaining("tc init --agent"),
          }),
        );
      } finally {
        project.cleanup();
      }
    }
  });
});

describe("stop.js hook script stdin handling", () => {
  // The compiled gate entry point is spawned directly (pretest builds dist).
  // Codex feeds hook input as an unclosed stream, so the script must never
  // block on stdin: it reads the first line with a short timeout instead.
  const SCRIPT = new URL("../../dist/hooks/stop.js", import.meta.url).pathname;

  it("releases the loop guard when stop_hook_active=true arrives on stdin", () => {
    const project = createHookProject({ takeOver: "always" }, true);
    const database = createStoreAt(project.databasePath);
    insertTask(database, { id: "T-1", activatedAt: FIXED_TIMESTAMP });
    insertNode(database, "T-1", "execute-1", "execute");
    database.close();

    try {
      const result = spawnSync(process.execPath, [SCRIPT, project.configPath], {
        encoding: "utf8",
        input: '{"stop_hook_active":true}\n',
        timeout: 10_000,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    } finally {
      project.cleanup();
    }
  });

  it("never hangs on an unclosed stdin stream and still blocks active work", () => {
    const project = createHookProject({ takeOver: "always" }, true);
    const database = createStoreAt(project.databasePath);
    insertTask(database, { id: "T-1", activatedAt: FIXED_TIMESTAMP });
    insertNode(database, "T-1", "execute-1", "execute");
    database.close();

    try {
      // Keep stdin open past the 1s read timeout (simulating a stream that
      // is not closed); the script must still finish and block.
      const result = spawnSync(process.execPath, [SCRIPT, project.configPath], {
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.status).toBe(2);
      expect(result.stdout).toContain("tc-breadcrumb/v1");
    } finally {
      project.cleanup();
    }
  });
});
