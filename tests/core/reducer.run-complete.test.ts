import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { project } from "../../src/core/projector.js";
import { run, runComplete, taskNew } from "../../src/core/reducer.js";
import {
  getAttempts,
  getEvidence,
  getLastEventSeq,
  getObligationResults,
  getTask,
} from "../../src/store/query.js";
import { loadFixtureFile } from "../helpers/load-fixture.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import { expectZeroFacts, queryEvents, VALID_RESULT } from "./reducer-utils.js";

describe("reducer runComplete", () => {
  it("atomically closes the attempt, binds evidence and satisfies all three obligations", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Complete me",
        level: 1,
        reason: "reason",
      }).taskId;
      const runResult = run(database, taskId);

      const result = runComplete(database, taskId, {
        attemptId: runResult.nodeBrief!.attemptId,
        result: VALID_RESULT,
      });

      expect(result.status).toBe("done");
      expect(result.next).toBeNull();
      expect(project(database, taskId).doneObligations).toBe(3);

      const task = getTask(database, taskId)!;
      expect(task.revision).toBe(3);

      const attempts = getAttempts(database, taskId);
      expect(attempts).toEqual([
        expect.objectContaining({
          nodeId: "execute-1",
          status: "finished",
          outcome: "success",
          resultJson: JSON.stringify(VALID_RESULT),
        }),
        expect.objectContaining({
          nodeId: "record-1",
          status: "finished",
          outcome: "success",
          resultJson: JSON.stringify(VALID_RESULT.record),
        }),
      ]);

      const evidence = getEvidence(database, taskId);
      expect(evidence).toHaveLength(3);
      expect(evidence.every((row) => row.taskId === taskId)).toBe(true);
      expect(evidence[0]).toMatchObject({
        nodeAttemptId: attempts[0]!.id,
        type: "validation",
      });
      expect(evidence[2]).toMatchObject({
        nodeAttemptId: attempts[1]!.id,
        type: "note",
      });

      expect(getObligationResults(database, taskId)).toEqual([
        expect.objectContaining({
          nodeId: "execute-1",
          obligationId: "minimum-validation-recorded",
          status: "satisfied",
        }),
        expect.objectContaining({
          nodeId: "execute-1",
          obligationId: "requested-outcome-produced",
          status: "satisfied",
        }),
        expect.objectContaining({
          nodeId: "record-1",
          obligationId: "result-and-scope-retained",
          status: "satisfied",
        }),
      ]);

      expect(
        queryEvents(database, taskId).map((event) => event.eventType),
      ).toEqual(["task.created", "task.activated", "attempt.finished"]);
      expect(getLastEventSeq(database, taskId)).toBe(3);
      expect(queryEvents(database, taskId)[2]!.postTaskRevision).toBe(3);
    } finally {
      database.close();
    }
  });

  it("keeps the record obligation pending when the result has no record segment", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "No record",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);

      runComplete(database, taskId, {
        result: {
          summary: VALID_RESULT.summary,
          evidence: VALID_RESULT.evidence,
        },
      });

      const projection = project(database, taskId);
      expect(projection.status).toBe("active");
      expect(projection.doneObligations).toBe(2);
      expect(projection.totalObligations).toBe(3);
      expect(getObligationResults(database, taskId)).toHaveLength(2);
      expect(projection.runnableNodes).toEqual(["record-1"]);
      // The unique next claims the runnable record-1 node; the missing record
      // segment is submitted as the standalone record result.
      expect(projection.next).toBe(`tc run ${taskId} --node record-1`);
    } finally {
      database.close();
    }
  });

  it("reaches done by completing record-1 standalone after a record-less execute result", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Record late",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Done",
          evidence: [{ type: "validation", reference: "r", summary: "ok" }],
        },
      });

      const claimed = run(database, taskId, { nodeId: "record-1" });
      const result = runComplete(database, taskId, {
        nodeId: "record-1",
        attemptId: claimed.nodeBrief!.attemptId,
        result: { summary: "Recorded late" },
      });

      expect(result.status).toBe("done");
      expect(result.next).toBeNull();
      expect(project(database, taskId).doneObligations).toBe(3);

      const attempts = getAttempts(database, taskId);
      expect(attempts).toEqual([
        expect.objectContaining({
          nodeId: "execute-1",
          status: "finished",
          outcome: "success",
        }),
        expect.objectContaining({
          nodeId: "record-1",
          status: "finished",
          outcome: "success",
          resultJson: JSON.stringify({ summary: "Recorded late" }),
        }),
      ]);
      expect(getEvidence(database, taskId)).toHaveLength(2);
      expect(getEvidence(database, taskId)[1]).toMatchObject({
        nodeAttemptId: attempts[1]!.id,
        type: "note",
        reference: `record://${taskId}`,
      });
    } finally {
      database.close();
    }
  });

  it("rejects a record result that fails the record schema with TC_LIFECYCLE_RESULT_INVALID", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Bad record",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);
      runComplete(database, taskId, {
        result: {
          summary: "Done",
          evidence: [{ type: "validation", reference: "r", summary: "ok" }],
        },
      });
      run(database, taskId, { nodeId: "record-1" });

      const error = captureTaskcraftError(() =>
        runComplete(database, taskId, {
          nodeId: "record-1",
          result: { summary: "" },
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID);
      // No record facts were written: the record attempt stays created and
      // the revision and evidence set are unchanged.
      expect(getTask(database, taskId)!.revision).toBe(4);
      expect(getAttempts(database, taskId)[1]).toMatchObject({
        nodeId: "record-1",
        status: "created",
      });
      expect(getEvidence(database, taskId)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("rejects completing an unknown node with TC_ATTEMPT_REF_INVALID", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Unknown node",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);

      const error = captureTaskcraftError(() =>
        runComplete(database, taskId, {
          nodeId: "review-1",
          result: { summary: "x" },
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(getEvidence(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects a schema-invalid result with TC_LIFECYCLE_RESULT_INVALID and writes nothing", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Bad result",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);

      const error = captureTaskcraftError(() =>
        runComplete(database, taskId, {
          result: { summary: "", evidence: [] },
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID);
      expectZeroFacts(database, taskId, 2);
    } finally {
      database.close();
    }
  });

  it("rejects a result without validation evidence and rolls back every write", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "No validation",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);

      const error = captureTaskcraftError(() =>
        runComplete(database, taskId, {
          result: {
            summary: "Done",
            evidence: [
              { type: "test", reference: "ref://test", summary: "Tests pass" },
            ],
          },
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_REQUIRED_OBLIGATION_MISSING);
      expectZeroFacts(database, taskId, 2);
    } finally {
      database.close();
    }
  });

  it("rolls back atomically on the transaction-rollback fixture: no partial facts", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "transaction-rollback");

      const error = captureTaskcraftError(() =>
        runComplete(database, "T-105", {
          result: { summary: "", evidence: [] },
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID);
      expect(getEvidence(database, "T-105")).toHaveLength(0);
      expect(getObligationResults(database, "T-105")).toHaveLength(0);
      expect(getAttempts(database, "T-105")[0]).toMatchObject({
        status: "running",
      });
      expect(getTask(database, "T-105")!.revision).toBe(2);
      expect(getLastEventSeq(database, "T-105")).toBe(2);
    } finally {
      database.close();
    }
  });

  it("rejects an attempt that belongs to another task with TC_ATTEMPT_REF_INVALID", () => {
    const database = createMigratedDatabase();

    try {
      const otherTaskId = taskNew(database, {
        title: "Other task",
        level: 1,
        reason: "reason",
      }).taskId;
      const otherAttemptId = run(database, otherTaskId).nodeBrief!.attemptId;
      const taskId = taskNew(database, {
        title: "This task",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);

      const error = captureTaskcraftError(() =>
        runComplete(database, taskId, {
          attemptId: otherAttemptId,
          result: VALID_RESULT,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_ATTEMPT_REF_INVALID);
      expect(getEvidence(database, taskId)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("rejects runComplete on a cancelled task", () => {
    const database = createMigratedDatabase();

    try {
      const taskId = taskNew(database, {
        title: "Cancelled run",
        level: 1,
        reason: "reason",
      }).taskId;
      run(database, taskId);
      cancelTask(database, taskId);

      const error = captureTaskcraftError(() =>
        runComplete(database, taskId, { result: VALID_RESULT }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_TASK_ALREADY_CANCELLED);
    } finally {
      database.close();
    }
  });
});

function cancelTask(
  database: Parameters<typeof runComplete>[0],
  taskId: string,
): void {
  database
    .prepare(
      "UPDATE tasks SET cancelled_at = ?, cancel_reason = 'x', updated_at = ? WHERE id = ?",
    )
    .run("2026-08-11T00:00:00.000Z", "2026-08-11T00:00:00.000Z", taskId);
}
