import { describe, expect, it } from "vitest";

import type { TaskcraftDatabase } from "../../src/store/database.js";
import * as query from "../../src/store/query.js";
import type {
  AgentRunRow,
  AttemptRow,
  BlockerRow,
  EvidenceRow,
  LifecycleGraph,
  ObligationResultRow,
  InheritedPlanningRow,
  TaskRelations,
} from "../../src/store/query.js";
import type { TaskSnapshot } from "../../src/store/revision-guard.js";
import {
  createMigratedDatabase,
  insertL1Fixture,
  insertTask,
} from "./helpers.js";

describe("query model", () => {
  it("returns nulls and empty collections for an empty database", () => {
    const database = createMigratedDatabase();

    try {
      expect(query.getTask(database, "task-unknown")).toBeNull();
      expect(query.getLifecycle(database, "task-unknown", 1)).toEqual({
        nodes: [],
        edges: [],
        obligations: [],
      });
      expect(query.getAttempts(database, "task-unknown")).toEqual([]);
      expect(query.getEvidence(database, "task-unknown")).toEqual([]);
      expect(query.getAgentRuns(database, "task-unknown")).toEqual([]);
      expect(query.getAgentRuns(database)).toEqual([]);
      expect(query.getObligationResults(database, "task-unknown")).toEqual([]);
      expect(query.getOpenBlockers(database, "task-unknown")).toEqual([]);
      expect(query.getLastEventSeq(database, "task-unknown")).toBe(0);
      expect(query.getLifecycleSpecBindings(database, "task-unknown")).toEqual(
        [],
      );
      expect(query.getSpecImpactResults(database, "task-unknown")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("returns the plain-data task snapshot for an existing task", () => {
    const database = createMigratedDatabase();

    try {
      insertTask(database, { id: "task-1", title: "Query task", level: 2 });

      const snapshot = query.getTask(database, "task-1");

      expect(snapshot).toEqual({
        id: "task-1",
        title: "Query task",
        level: 2,
        objectiveMd: "Objective",
        scopeJson: "{}",
        acceptanceJson: "[]",
        nonGoalsJson: "[]",
        classificationFactsJson: "{}",
        classificationReasonsJson: "[]",
        parentTaskId: null,
        activatedAt: null,
        cancelledAt: null,
        cancelReason: null,
        currentLifecycleRevision: 1,
        revision: 1,
        createdAt: "2026-08-11T00:00:00.000Z",
        updatedAt: "2026-08-11T00:00:00.000Z",
      });
    } finally {
      database.close();
    }
  });

  it("returns the lifecycle graph for a revision", () => {
    const database = createMigratedDatabase();

    try {
      insertL1Fixture(database);

      const graph = query.getLifecycle(database, "task-l1", 1);

      expect(graph.nodes.map((node) => [node.id, node.kind])).toEqual([
        ["execute-1", "execute"],
        ["record-1", "record"],
      ]);
      expect(
        graph.edges.map((edge) => [edge.fromNodeId, edge.toNodeId]),
      ).toEqual([["execute-1", "record-1"]]);
      expect(graph.obligations.map((obligation) => obligation.id)).toEqual([
        "minimum-validation-recorded",
        "requested-outcome-produced",
        "result-and-scope-retained",
      ]);
      expect(query.getLifecycle(database, "task-l1", 2)).toEqual({
        nodes: [],
        edges: [],
        obligations: [],
      });
    } finally {
      database.close();
    }
  });

  it("returns runtime facts: attempts, evidence, results, blockers, events", () => {
    const database = createMigratedDatabase();

    try {
      insertL1Fixture(database);

      expect(query.getAttempts(database, "task-l1")).toEqual([
        expect.objectContaining({
          id: "attempt-1",
          nodeId: "execute-1",
          attemptNumber: 1,
          status: "finished",
          outcome: "success",
          resultJson: "{}",
        }),
      ]);
      expect(query.getEvidence(database, "task-l1")).toEqual([
        expect.objectContaining({
          id: "evidence-1",
          nodeAttemptId: "attempt-1",
          type: "validation",
        }),
      ]);
      expect(query.getObligationResults(database, "task-l1")).toEqual([
        expect.objectContaining({
          nodeId: "execute-1",
          obligationId: "requested-outcome-produced",
          status: "satisfied",
          satisfiedByEvidenceId: "evidence-1",
        }),
      ]);
      expect(query.getOpenBlockers(database, "task-l1")).toEqual([
        expect.objectContaining({
          id: "blocker-1",
          kind: "evidence",
          waitingReason: "failed_retries_exhausted",
          status: "open",
        }),
      ]);
      expect(query.getLastEventSeq(database, "task-l1")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("keeps the query model read-only at the type level", () => {
    const readOnly: ReadOnlyQueryModel = query;

    expect(Object.keys(readOnly).sort()).toEqual([
      "getAgentRuns",
      "getAttempts",
      "getEvidence",
      "getInheritedPlanning",
      "getLastEventSeq",
      "getLifecycle",
      "getLifecycleSpecBindings",
      "getObligationResults",
      "getOpenBlockers",
      "getReviewFindings",
      "getReviewLinks",
      "getSpecImpactResults",
      "getTask",
      "getTaskFacts",
      "getTaskRelations",
      "listTasks",
    ]);
  });
});

type ReadOnlyQueryModel = {
  getAgentRuns(database: TaskcraftDatabase, taskId?: string): AgentRunRow[];
  getTask(database: TaskcraftDatabase, taskId: string): TaskSnapshot | null;
  getLifecycle(
    database: TaskcraftDatabase,
    taskId: string,
    revision: number,
  ): LifecycleGraph;
  getAttempts(database: TaskcraftDatabase, taskId: string): AttemptRow[];
  getEvidence(database: TaskcraftDatabase, taskId: string): EvidenceRow[];
  getObligationResults(
    database: TaskcraftDatabase,
    taskId: string,
  ): ObligationResultRow[];
  getOpenBlockers(database: TaskcraftDatabase, taskId: string): BlockerRow[];
  getLastEventSeq(database: TaskcraftDatabase, taskId: string): number;
  getLifecycleSpecBindings(
    database: TaskcraftDatabase,
    taskId: string,
    revision?: number,
    nodeId?: string,
  ): query.LifecycleSpecBindingRow[];
  getSpecImpactResults(
    database: TaskcraftDatabase,
    taskId: string,
    revision?: number,
  ): query.SpecImpactResultRow[];
  getInheritedPlanning(
    database: TaskcraftDatabase,
    taskId: string,
    revision: number,
  ): InheritedPlanningRow | null;
  getTaskRelations(
    database: TaskcraftDatabase,
    taskId: string,
    revision: number,
  ): TaskRelations;
  listTasks(database: TaskcraftDatabase): TaskSnapshot[];
};
