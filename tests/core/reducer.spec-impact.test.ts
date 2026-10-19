import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { run, runComplete, taskNew } from "../../src/core/reducer.js";
import {
  getAttempts,
  getEvidence,
  getObligationResults,
  getSpecImpactResults,
  getTask,
} from "../../src/store/query.js";
import type { TaskcraftDatabase } from "../../src/store/database.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";

describe("Spec Impact reducer contract", () => {
  it("records none and satisfies the compiler obligation atomically", () => {
    const database = createMigratedDatabase();
    try {
      const context = setupRecordAttempt(database);
      const result = runComplete(database, context.taskId, {
        nodeId: "record-1",
        result: {
          summary: "Closure recorded",
          specImpact: {
            outcome: "none",
            reason: "The change does not create a reusable rule",
          },
        },
      });

      expect(result.status).toBe("done");
      expect(getSpecImpactResults(database, context.taskId)).toEqual([
        expect.objectContaining({
          recordAttemptId: context.recordAttemptId,
          outcome: "none",
          detailsJson: JSON.stringify({
            reason: "The change does not create a reusable rule",
          }),
        }),
      ]);
      expect(
        getObligationResults(database, context.taskId).map(
          (obligation) => obligation.obligationId,
        ),
      ).toContain("spec-impact-recorded");
    } finally {
      database.close();
    }
  });

  it("rejects an empty none reason without writing Record facts", () => {
    const database = createMigratedDatabase();
    try {
      const context = setupRecordAttempt(database);
      const before = snapshotCounts(database, context.taskId);

      const error = captureTaskcraftError(() =>
        runComplete(database, context.taskId, {
          nodeId: "record-1",
          result: {
            summary: "Closure recorded",
            specImpact: { outcome: "none", reason: "" },
          },
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_LIFECYCLE_RESULT_INVALID);
      expect(snapshotCounts(database, context.taskId)).toEqual(before);
      expect(recordAttempt(database, context.recordAttemptId)).toMatchObject({
        status: "created",
        outcome: null,
      });
    } finally {
      database.close();
    }
  });

  it("stores engineering and domain candidates without Registry authority", () => {
    const database = createMigratedDatabase();
    try {
      const context = setupRecordAttempt(database);
      runComplete(database, context.taskId, {
        nodeId: "record-1",
        result: {
          summary: "Candidates retained for owner review",
          specImpact: {
            outcome: "candidate",
            candidates: [
              {
                kind: "engineering",
                title: "Keep adapters pure",
                rule: "Adapters render the shared DTO only",
                reason: "Two hosts need the same delivery contract",
                ownerDecision:
                  "Confirm before adding it to an engineering Spec",
              },
              {
                kind: "domain",
                title: "Review authority",
                rule: "Domain changes require product-owner approval",
                reason: "Code observations cannot establish business truth",
                ownerDecision: "Product owner must accept or reject this rule",
              },
            ],
          },
        },
      });

      const stored = getSpecImpactResults(database, context.taskId)[0]!;
      expect(stored.outcome).toBe("candidate");
      expect(JSON.parse(stored.detailsJson)).toMatchObject({
        candidates: [
          { kind: "engineering" },
          { kind: "domain", ownerDecision: expect.any(String) },
        ],
      });
    } finally {
      database.close();
    }
  });

  it("accepts updated only with the command-resolved snapshot and Task evidence", () => {
    const database = createMigratedDatabase();
    try {
      const context = setupRecordAttempt(database);
      const impact = updatedImpact(context.executeEvidenceId);
      const result = runComplete(database, context.taskId, {
        nodeId: "record-1",
        result: { summary: "Spec updated", specImpact: impact },
        resolvedSpecImpact: impact,
      });

      expect(result.status).toBe("done");
      expect(getSpecImpactResults(database, context.taskId)[0]).toMatchObject({
        outcome: "updated",
        recordAttemptId: context.recordAttemptId,
      });
    } finally {
      database.close();
    }
  });

  it("compares command-resolved updates semantically and rejects duplicate Spec ids", () => {
    const database = createMigratedDatabase();
    try {
      const context = setupRecordAttempt(database);
      const submitted = {
        outcome: "updated" as const,
        updates: [
          {
            specId: "engineering.delivery",
            path: "docs/delivery.md",
            evidenceRefs: [context.executeEvidenceId, context.testEvidenceId],
          },
        ],
      };
      const resolved = {
        outcome: "updated" as const,
        updates: [
          {
            evidenceRefs: [context.testEvidenceId, context.executeEvidenceId],
            path: "docs/delivery.md",
            specId: "engineering.delivery",
          },
        ],
      };

      expect(
        runComplete(database, context.taskId, {
          nodeId: "record-1",
          result: {
            summary: "Spec updated",
            specImpact: submitted,
          },
          resolvedSpecImpact: resolved,
        }).status,
      ).toBe("done");
    } finally {
      database.close();
    }

    const duplicateDatabase = createMigratedDatabase();
    try {
      const context = setupRecordAttempt(duplicateDatabase);
      const update = updatedImpact(context.executeEvidenceId).updates[0]!;
      const duplicate = {
        outcome: "updated" as const,
        updates: [update, { ...update }],
      };
      const error = captureTaskcraftError(() =>
        runComplete(duplicateDatabase, context.taskId, {
          nodeId: "record-1",
          result: { summary: "Duplicate", specImpact: duplicate },
          resolvedSpecImpact: duplicate,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_SPEC_IMPACT_INVALID);
      expect(getSpecImpactResults(duplicateDatabase, context.taskId)).toEqual(
        [],
      );
    } finally {
      duplicateDatabase.close();
    }
  });

  it("rejects note evidence as proof of an updated Spec", () => {
    const database = createMigratedDatabase();
    try {
      const context = setupRecordAttempt(database);
      const impact = updatedImpact(context.noteEvidenceId);
      const before = snapshotCounts(database, context.taskId);

      const error = captureTaskcraftError(() =>
        runComplete(database, context.taskId, {
          nodeId: "record-1",
          result: { summary: "Self-asserted update", specImpact: impact },
          resolvedSpecImpact: impact,
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_SPEC_IMPACT_INVALID);
      expect(snapshotCounts(database, context.taskId)).toEqual(before);
    } finally {
      database.close();
    }
  });

  it("rejects foreign evidence and invalid command resolution with full rollback", () => {
    for (const variant of [
      "foreign-evidence",
      "mismatched-resolution",
      "unrecognized-resolution-field",
    ] as const) {
      const database = createMigratedDatabase();
      try {
        const context = setupRecordAttempt(database);
        const submitted = updatedImpact(
          variant === "foreign-evidence"
            ? "ev-foreign"
            : context.executeEvidenceId,
        );
        const resolved =
          variant === "mismatched-resolution"
            ? updatedImpact(context.executeEvidenceId, "docs/other.md")
            : variant === "unrecognized-resolution-field"
              ? ({ ...submitted, unexpected: true } as typeof submitted)
              : submitted;
        const before = snapshotCounts(database, context.taskId);

        const error = captureTaskcraftError(() =>
          runComplete(database, context.taskId, {
            nodeId: "record-1",
            result: { summary: "Spec updated", specImpact: submitted },
            resolvedSpecImpact: resolved,
          }),
        );

        expect(error.code).toBe(ERROR_CODES.TC_SPEC_IMPACT_INVALID);
        expect(snapshotCounts(database, context.taskId)).toEqual(before);
        expect(recordAttempt(database, context.recordAttemptId)).toMatchObject({
          status: "created",
          outcome: null,
        });
      } finally {
        database.close();
      }
    }
  });

  it("rolls back the Record attempt, evidence and obligations when Impact insertion fails", () => {
    const database = createMigratedDatabase();
    try {
      const context = setupRecordAttempt(database);
      const before = snapshotCounts(database, context.taskId);
      database.exec(`
        CREATE TRIGGER spec_impact_test_failure
        BEFORE INSERT ON spec_impact_results BEGIN
          SELECT RAISE(ABORT, 'forced Spec Impact failure');
        END;
      `);

      expect(() =>
        runComplete(database, context.taskId, {
          nodeId: "record-1",
          result: {
            summary: "Must roll back",
            specImpact: { outcome: "none", reason: "No reusable rule" },
          },
        }),
      ).toThrow(/forced Spec Impact failure/);

      expect(snapshotCounts(database, context.taskId)).toEqual(before);
      expect(recordAttempt(database, context.recordAttemptId)).toMatchObject({
        status: "created",
        outcome: null,
        resultJson: null,
      });
    } finally {
      database.close();
    }
  });
});

function setupRecordAttempt(database: TaskcraftDatabase) {
  const { taskId } = taskNew(database, {
    title: "Spec Impact",
    level: 1,
    reason: "closure contract",
  });
  run(database, taskId);
  runComplete(database, taskId, {
    result: {
      summary: "Delivery complete",
      evidence: [
        {
          type: "validation",
          reference: "tests/spec-impact.test.ts",
          summary: "Delivery validated",
        },
        {
          type: "test",
          reference: "tests/spec-impact.integration.ts",
          summary: "Integration validated",
        },
        {
          type: "note",
          reference: "note://claim",
          summary: "A note cannot prove a Spec update",
        },
      ],
    },
  });
  const [executeEvidence, testEvidence, noteEvidence] = getEvidence(
    database,
    taskId,
  );
  const recordAttemptId = run(database, taskId, {
    nodeId: "record-1",
  }).nodeBrief!.attemptId;
  return {
    taskId,
    executeEvidenceId: executeEvidence!.id,
    testEvidenceId: testEvidence!.id,
    noteEvidenceId: noteEvidence!.id,
    recordAttemptId,
  };
}

function updatedImpact(
  evidenceId: string,
  path = "docs/delivery.md",
): {
  outcome: "updated";
  updates: Array<{
    specId: string;
    path: string;
    evidenceRefs: string[];
  }>;
} {
  return {
    outcome: "updated" as const,
    updates: [
      {
        specId: "engineering.delivery",
        path,
        evidenceRefs: [evidenceId],
      },
    ],
  };
}

function snapshotCounts(database: TaskcraftDatabase, taskId: string) {
  return {
    revision: getTask(database, taskId)!.revision,
    evidence: getEvidence(database, taskId).length,
    obligations: getObligationResults(database, taskId).length,
    impacts: getSpecImpactResults(database, taskId).length,
  };
}

function recordAttempt(database: TaskcraftDatabase, attemptId: string) {
  return getAttempts(database, "T-1").find(
    (attempt) => attempt.id === attemptId,
  );
}
