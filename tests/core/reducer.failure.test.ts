import { describe, expect, it } from "vitest";

import { project } from "../../src/core/projector.js";
import { run, runFail, taskNew } from "../../src/core/reducer.js";
import { getAttempts } from "../../src/store/query.js";
import { loadFixtureFile } from "../helpers/load-fixture.js";
import { createMigratedDatabase } from "../store/helpers.js";

describe("reducer failure semantics", () => {
  it("writes an open failed_retries_exhausted blocker after three consecutive failures", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Fail thrice",
        level: 1,
        reason: "reason",
      }).taskId;

      for (let index = 1; index <= 3; index += 1) {
        const runResult = run(database, taskId);
        runFail(database, taskId, {
          attemptId: runResult.nodeBrief!.attemptId,
          reason: `attempt ${index} failed`,
        });
      }

      const projection = project(database, taskId);
      expect(projection.status).toBe("waiting");
      expect(projection.waitingReason).toBe("failed_retries_exhausted");
      expect(projection.next).toBe(`tc task resume ${taskId} --resolve`);

      const blockers = database
        .prepare(
          "SELECT kind, waiting_reason AS waitingReason FROM blockers WHERE task_id = ? AND status = 'open'",
        )
        .all(taskId) as Array<{ kind: string; waitingReason: string }>;
      expect(blockers).toEqual([
        expect.objectContaining({
          kind: "evidence",
          waitingReason: "failed_retries_exhausted",
        }),
      ]);

      expect(
        getAttempts(database, taskId).filter(
          (attempt) => attempt.outcome === "failed",
        ),
      ).toHaveLength(3);
      expect(
        getAttempts(database, taskId).every(
          (attempt) => attempt.status === "failed",
        ),
      ).toBe(true);
    } finally {
      database.close();
    }
  });

  it("does not open a blocker before the retry budget is exhausted", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Fail twice",
        level: 1,
        reason: "reason",
      }).taskId;

      for (let index = 1; index <= 2; index += 1) {
        const runResult = run(database, taskId);
        runFail(database, taskId, {
          attemptId: runResult.nodeBrief!.attemptId,
          reason: `attempt ${index} failed`,
        });
      }

      expect(project(database, taskId).status).toBe("active");
      const blockerCount = database
        .prepare("SELECT COUNT(*) AS count FROM blockers WHERE task_id = ?")
        .get(taskId) as { count: number };
      expect(blockerCount.count).toBe(0);
    } finally {
      database.close();
    }
  });

  it("blocks obligation results whose evidence belongs to another node (trigger)", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "validation-missing");
      const insert = database.prepare(
        `INSERT INTO obligation_results (
           task_id, lifecycle_revision, node_id, obligation_id, status,
           satisfied_by_evidence_id, skip_reason, updated_at
         ) VALUES ('T-102', 1, 'record-1', 'result-and-scope-retained',
           'satisfied', 'ev-T-102-att-T-102-execute-1-1', NULL, ?)`,
      );

      expect(() => insert.run("2026-08-11T00:00:00.000Z")).toThrow(
        /obligation evidence must belong to the target node attempt/,
      );
    } finally {
      database.close();
    }
  });
});
