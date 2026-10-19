import { describe, expect, it } from "vitest";

import { buildTaskShowData } from "../../src/commands/task-show.js";
import { renderTaskShowData } from "../../src/commands/render.js";
import {
  reviewChanges,
  reviewStart,
  run,
  runComplete,
  cancel,
  taskNew,
} from "../../src/core/reducer.js";
import { getTaskRelations } from "../../src/store/query.js";
import { createMigratedDatabase } from "../store/helpers.js";
import {
  L2_EXECUTE_RESULT,
  reviewStartInput,
  setupL2ToReview,
  VALID_RESULT,
} from "./reducer-utils.js";
import { passReview, reviewInput, setupL3ToFeasibility } from "./l3-utils.js";

describe("claimed Node Brief query", () => {
  it("returns null before a claim and after completion, and repeats the run card without writing", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId } = taskNew(db, {
        title: "Recover",
        level: 1,
        reason: "local",
      });
      expect(buildTaskShowData(db, taskId).nodeBrief).toBeNull();
      const claimed = run(db, taskId);
      const bytes = db.serialize();
      const first = buildTaskShowData(db, taskId);
      expect(first.nodeBrief).toEqual(claimed.nodeBrief);
      expect(buildTaskShowData(db, taskId)).toEqual(first);
      expect(run(db, taskId).nodeBrief).toEqual(first.nodeBrief);
      expect(db.serialize()).toEqual(bytes);
      expect(renderTaskShowData(first)).toContain("Result schema:");
      expect(renderTaskShowData(first)).toContain(
        `Attempt: att-${taskId}-execute-1-1`,
      );
      runComplete(db, taskId, { result: VALID_RESULT });
      expect(buildTaskShowData(db, taskId).nodeBrief).toBeNull();
    } finally {
      db.close();
    }
  });

  it("does not expose a stale claimed card after cancellation", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId } = taskNew(db, {
        title: "Cancel",
        level: 1,
        reason: "local",
      });
      run(db, taskId);
      cancel(db, taskId, { reason: "No longer required" });
      expect(buildTaskShowData(db, taskId).nodeBrief).toBeNull();
    } finally {
      db.close();
    }
  });

  it("recovers Review from its persisted link, then selects the successor and its second Review", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId, executeAttemptId } = setupL2ToReview(db);
      expect(buildTaskShowData(db, taskId).nodeBrief).toBeNull();
      const review = reviewStart(
        db,
        taskId,
        reviewStartInput(taskId, executeAttemptId),
      );
      const bytes = db.serialize();
      expect(buildTaskShowData(db, taskId).nodeBrief).toEqual(review.nodeBrief);
      expect(db.serialize()).toEqual(bytes);
      const changes = reviewChanges(db, taskId, {
        taskId,
        attemptId: review.reviewAttemptId,
        reviewedAttemptId: executeAttemptId,
        finding: "Fix boundary",
      });
      expect(buildTaskShowData(db, taskId).nodeBrief).toEqual(
        changes.nodeBrief,
      );
      runComplete(db, taskId, {
        result: { ...L2_EXECUTE_RESULT, summary: "Boundary fixed" },
      });
      const second = reviewStart(
        db,
        taskId,
        reviewStartInput(taskId, changes.successorAttemptId!),
      );
      const secondBytes = db.serialize();
      const recovered = buildTaskShowData(db, taskId).nodeBrief;
      expect(recovered).toEqual(second.nodeBrief);
      expect(recovered?.reviewContext).toMatchObject({
        reviewedAttemptId: changes.successorAttemptId,
        attemptNumber: 2,
        result: { summary: "Boundary fixed" },
      });
      expect(
        recovered?.reviewContext?.evidence.every((item) =>
          item.id.includes(changes.successorAttemptId!),
        ),
      ).toBe(true);
      expect(db.serialize()).toEqual(secondBytes);
    } finally {
      db.close();
    }
  });

  it("shows bound Specs on an existing card without reading the Registry", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId } = taskNew(db, {
        title: "Bound",
        level: 1,
        reason: "existing claim",
        initialSpecBindings: [
          {
            specId: "engineering.missing",
            kind: "engineering",
            path: "docs/missing.md",
            duty: "required",
          },
        ],
      });
      run(db, taskId);
      const bytes = db.serialize();
      // Nothing named docs/missing.md exists anywhere. The card still renders
      // the recorded binding, because a binding is a Store fact rather than a
      // lookup of the document it names.
      const data = buildTaskShowData(db, taskId);
      expect(data.nodeBrief?.specs).toEqual([
        {
          id: "engineering.missing",
          kind: "engineering",
          duty: "required",
          path: "docs/missing.md",
        },
      ]);
      expect(data.specs.bindings[0]).toMatchObject({
        id: "engineering.missing",
        path: "docs/missing.md",
      });
      expect(db.serialize()).toEqual(bytes);
    } finally {
      db.close();
    }
  });

  it("recovers feasibility Review but leaves a modules parent card null while next points at a child", () => {
    const db = createMigratedDatabase();
    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(db);
      const review = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      expect(
        buildTaskShowData(db, taskId).nodeBrief?.reviewContext,
      ).toMatchObject({
        purpose: "feasibility",
        reviewedAttemptId: planAttemptId,
        reviewedNodeKind: "plan",
      });
      passReview(db, taskId, review.reviewAttemptId, planAttemptId);
      const child = getTaskRelations(db, taskId, 2).children[0]!.childTaskId;
      const claimed = run(db, child);
      const bytes = db.serialize();
      const parent = buildTaskShowData(db, taskId);
      expect(parent.next).toContain(child);
      expect(parent.nodeBrief).toBeNull();
      expect(buildTaskShowData(db, child).nodeBrief).toEqual(claimed.nodeBrief);
      expect(db.serialize()).toEqual(bytes);
    } finally {
      db.close();
    }
  });
});
