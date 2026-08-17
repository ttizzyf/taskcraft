import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import {
  reviewChanges,
  reviewReplan,
  reviewStart,
  run,
  runComplete,
} from "../../src/core/reducer.js";
import { project } from "../../src/core/projector.js";
import {
  getAgentRuns,
  getLifecycle,
  getTaskFacts,
} from "../../src/store/query.js";
import { loadFixtureFile } from "../helpers/load-fixture.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import {
  L3_EXECUTE_RESULT,
  L3_FRAME_RESULT,
  L3_PLAN_RESULT,
  passReview,
  reviewInput,
  setupL3ToFeasibility,
} from "./l3-utils.js";

// These JSON snapshots intentionally exercise read compatibility for the
// historical tc-l3/1 single-task graph. Current tc-l3/2 modular facts are
// generated through reducer tests so relation tables cannot drift by hand.
describe("projector legacy tc-l3/1 fixtures", () => {
  it("projects l3-pass as done with all eight nodes satisfied", () => {
    const db = createMigratedDatabase();

    try {
      loadFixtureFile(db, "l3-pass");

      const projection = project(db, "T-301");

      expect(projection.status).toBe("done");
      expect(projection.next).toBeNull();
      expect(projection.doneObligations).toBe(9);
      expect(
        projection.nodeStatuses.map((node) => [node.nodeId, node.status]),
      ).toEqual([
        ["frame-1", "satisfied"],
        ["plan-1", "satisfied"],
        ["review-plan-1", "satisfied"],
        ["execute-1", "satisfied"],
        ["review-execute-1", "satisfied"],
        ["integrate-1", "satisfied"],
        ["review-integrate-1", "satisfied"],
        ["record-1", "satisfied"],
      ]);
    } finally {
      db.close();
    }
  });

  it("gates execute behind the feasibility review and opens it on pass", () => {
    const db = createMigratedDatabase();

    try {
      loadFixtureFile(db, "l3-feasibility-blocked");

      let projection = project(db, "T-302");
      expect(projection.status).toBe("active");
      expect(projection.next).toBe(
        "tc review start T-302 --node review-plan-1 --purpose feasibility --reviewed-attempt att-T-302-plan-1-1",
      );
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({ nodeId: "execute-1", status: "blocked" }),
      );

      const review = reviewStart(db, "T-302", {
        taskId: "T-302",
        nodeId: "review-plan-1",
        purpose: "feasibility",
        reviewedAttemptId: "att-T-302-plan-1-1",
        capability: "context-only",
        independenceStatus: "same-actor",
      });
      passReview(db, "T-302", review.reviewAttemptId, "att-T-302-plan-1-1");

      projection = project(db, "T-302");
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({ nodeId: "execute-1", status: "runnable" }),
      );
    } finally {
      db.close();
    }
  });

  it("re-gates a new plan attempt: it must pass its own feasibility review", () => {
    const db = createMigratedDatabase();

    try {
      loadFixtureFile(db, "l3-feasibility-blocked");

      // First feasibility review finds a blocking issue: the reducer closes
      // it with changes_requested and creates the successor plan-1-2.
      const review = reviewStart(db, "T-302", {
        taskId: "T-302",
        nodeId: "review-plan-1",
        purpose: "feasibility",
        reviewedAttemptId: "att-T-302-plan-1-1",
        capability: "context-only",
        independenceStatus: "same-actor",
      });
      const changed = reviewChanges(db, "T-302", {
        taskId: "T-302",
        attemptId: review.reviewAttemptId,
        reviewedAttemptId: "att-T-302-plan-1-1",
        finding: "The single child is not covered by the plan",
      });

      let projection = project(db, "T-302");
      expect(projection.runningNode).toBe("plan-1");
      expect(projection.next).toBe("tc run complete T-302 --node plan-1");
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({ nodeId: "execute-1", status: "blocked" }),
      );

      // The revised plan finishes; the gate stays closed until the new plan
      // passes its own feasibility review.
      runComplete(db, "T-302", {
        nodeId: "plan-1",
        attemptId: changed.successorAttemptId!,
        result: L3_PLAN_RESULT,
      });

      projection = project(db, "T-302");
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({ nodeId: "execute-1", status: "blocked" }),
      );
      expect(projection.next).toBe(
        "tc review start T-302 --node review-plan-1 --purpose feasibility --reviewed-attempt att-T-302-plan-1-2",
      );

      const secondReview = reviewStart(db, "T-302", {
        taskId: "T-302",
        nodeId: "review-plan-1",
        purpose: "feasibility",
        reviewedAttemptId: "att-T-302-plan-1-2",
        capability: "context-only",
        independenceStatus: "same-actor",
      });
      passReview(
        db,
        "T-302",
        secondReview.reviewAttemptId,
        "att-T-302-plan-1-2",
      );

      projection = project(db, "T-302");
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({ nodeId: "execute-1", status: "runnable" }),
      );
    } finally {
      db.close();
    }
  });

  it("does not satisfy the feasibility gate without a review link", () => {
    const db = createMigratedDatabase();

    try {
      loadFixtureFile(db, "l3-pass");
      // A passed review attempt without its review link cannot satisfy the
      // gate (the link purpose match is otherwise enforced by the store
      // trigger, so this is the observable projector-level invariant).
      db.prepare("DELETE FROM review_links WHERE review_attempt_id = ?").run(
        "att-T-301-review-plan-1-1",
      );

      const projection = project(db, "T-301");

      // The passed attempt without its link no longer counts as a satisfied
      // review: the gate node falls back to runnable even though the fixture
      // task is done (all obligation results are still satisfied), so the
      // review-satisfied invariant holds at the projector level.
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({
          nodeId: "review-plan-1",
          status: "runnable",
        }),
      );
      expect(projection.nodeStatuses).not.toContainEqual(
        expect.objectContaining({
          nodeId: "review-plan-1",
          status: "satisfied",
        }),
      );
    } finally {
      db.close();
    }
  });

  it("keeps integrate blocked until the single child's delivery review passes", () => {
    const db = createMigratedDatabase();

    try {
      loadFixtureFile(db, "l3-single-child");

      let projection = project(db, "T-306");
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({ nodeId: "integrate-1", status: "blocked" }),
      );
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({
          nodeId: "review-execute-1",
          status: "runnable",
        }),
      );
      expect(projection.next).toBe(
        "tc review start T-306 --node review-execute-1 --purpose delivery --reviewed-attempt att-T-306-execute-1-1",
      );

      // The single child's delivery review passes: the integrate gate opens.
      const review = reviewStart(db, "T-306", {
        taskId: "T-306",
        nodeId: "review-execute-1",
        purpose: "delivery",
        reviewedAttemptId: "att-T-306-execute-1-1",
        capability: "context-only",
        independenceStatus: "same-actor",
      });
      passReview(db, "T-306", review.reviewAttemptId, "att-T-306-execute-1-1");

      projection = project(db, "T-306");
      expect(projection.nodeStatuses).toContainEqual(
        expect.objectContaining({ nodeId: "integrate-1", status: "runnable" }),
      );
      expect(projection.next).toBe("tc run T-306 --node integrate-1");
    } finally {
      db.close();
    }
  });

  it("projects l3-waiting-decision as waiting with needs_decision remediation", () => {
    const db = createMigratedDatabase();

    try {
      loadFixtureFile(db, "l3-waiting-decision");

      const projection = project(db, "T-305");

      expect(projection.status).toBe("waiting");
      expect(projection.waitingReason).toBe("needs_decision");
      expect(projection.next).toBe("tc task show T-305");
      expect(projection.runnableNodes).toEqual([]);
      expect(projection.runningNode).toBeNull();
    } finally {
      db.close();
    }
  });

  it("projects l3-conflict: a stale CAS is rejected and a fresh one succeeds", () => {
    const db = createMigratedDatabase();

    try {
      loadFixtureFile(db, "l3-conflict");

      const error = captureTaskcraftError(() =>
        runComplete(db, "T-307", {
          nodeId: "execute-1",
          result: L3_EXECUTE_RESULT,
          expectedRevision: 7,
        }),
      );
      expect(error.code).toBe(ERROR_CODES.TC_REVISION_CONFLICT);

      const completed = runComplete(db, "T-307", {
        nodeId: "execute-1",
        result: L3_EXECUTE_RESULT,
      });
      expect(completed.status).toBe("active");
      expect(completed.next).toBe(
        "tc review start T-307 --node review-execute-1 --purpose delivery --reviewed-attempt att-T-307-execute-1-1",
      );
    } finally {
      db.close();
    }
  });

  it("projects l3-stale as active while the stale observation stays queryable", () => {
    const db = createMigratedDatabase();

    try {
      loadFixtureFile(db, "l3-stale");

      const projection = project(db, "T-308");

      expect(projection.status).toBe("active");
      expect(projection.runningNode).toBe("review-execute-1");
      expect(projection.next).toBe(
        "tc review pass T-308 --attempt att-T-308-review-execute-1-1 --reviewed-attempt att-T-308-execute-1-1",
      );
      expect(getAgentRuns(db, "T-308")).toEqual([
        expect.objectContaining({
          id: "run-T-308-1",
          observationStatus: "stale",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  it("imports l3-fact-probe and l3-fact-expired with their facts queryable", () => {
    const db = createMigratedDatabase();

    try {
      loadFixtureFile(db, "l3-fact-probe");

      expect(getTaskFacts(db, "T-303")).toEqual([
        expect.objectContaining({
          id: "fact-T-303-1",
          category: "probe",
          subject: "api-availability",
          sourceAttemptId: "att-T-303-plan-1-1",
          evidenceId: "ev-T-303-probe-1",
        }),
      ]);

      loadFixtureFile(db, "l3-fact-expired");

      const facts = getTaskFacts(db, "T-304");
      expect(facts.map((fact) => fact.id)).toEqual([
        "fact-T-304-1",
        "fact-T-304-2",
        "fact-T-304-3",
      ]);
      expect(facts[1]).toMatchObject({ supersedesFactId: "fact-T-304-1" });
      expect(facts[2]).toMatchObject({ supersedesFactId: "fact-T-304-2" });
      expect(JSON.parse(facts[2]!.valueJson)).toEqual({
        url: "https://api.v3.example",
      });
    } finally {
      db.close();
    }
  });

  it("rebuilds the L3 graph on replan and re-gates execute behind a fresh plan", () => {
    const db = createMigratedDatabase();

    try {
      const { taskId, planAttemptId } = setupL3ToFeasibility(db);
      const review = reviewStart(
        db,
        taskId,
        reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
      );
      const replan = reviewReplan(db, taskId, {
        taskId,
        attemptId: review.reviewAttemptId,
        reviewedAttemptId: planAttemptId,
        reasonCode: "replan_required",
        finding: "The scope changed mid-review",
      });

      expect(replan.newRevision).toBe(2);
      const graph = getLifecycle(db, taskId, 2);
      expect(graph.nodes).toHaveLength(3);
      expect(graph.edges).toHaveLength(2);
      expect(graph.obligations).toHaveLength(3);

      const projection = project(db, taskId);
      expect(projection.next).toBe(`tc run ${taskId} --node frame-1`);
      expect(projection.nodeStatuses.map((node) => node.nodeId)).toEqual([
        "frame-1",
        "plan-1",
        "review-plan-1",
      ]);

      // The new revision replays the whole L3 sequence: frame, plan, and a
      // fresh feasibility review before execute opens again.
      run(db, taskId, { nodeId: "frame-1" });
      runComplete(db, taskId, { nodeId: "frame-1", result: L3_FRAME_RESULT });
      run(db, taskId, { nodeId: "plan-1" });
      runComplete(db, taskId, { nodeId: "plan-1", result: L3_PLAN_RESULT });

      expect(project(db, taskId).next).toBe(
        `tc review start ${taskId} --node review-plan-1 --purpose feasibility --reviewed-attempt att-${taskId}-plan-1-2`,
      );
      expect(project(db, taskId).nodeStatuses).toContainEqual(
        expect.objectContaining({
          nodeId: "review-plan-1",
          status: "runnable",
        }),
      );
    } finally {
      db.close();
    }
  });
});
