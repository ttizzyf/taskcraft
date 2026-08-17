// Entry gate decision matrix (pure decideEntry) and the thin IO wrapper
// (runEntryGate) against a real temporary project: off and ordinary Q&A stay
// silent with zero output, ask/always + durable request map to create
// decisions, an active task injects exactly one breadcrumb line, and malformed
// configs surface as stable TC_ADAPTER_* diagnostics.

import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { reviewStart, run } from "../../src/core/reducer.js";
import { decideEntry, runEntryGate } from "../../src/hooks/entry.js";
import { insertL1Fixture, insertNode, insertTask } from "../store/helpers.js";
import {
  passReview,
  reviewInput,
  setupL3ToFeasibility,
} from "../core/l3-utils.js";
import {
  activeProjection,
  createHookProject,
  createStoreAt,
  FIXED_TIMESTAMP,
  nonActiveProjection,
} from "./helpers.js";

describe("decideEntry pure matrix", () => {
  it("takeOver off stays silent for every projection and request", () => {
    expect(decideEntry("off", null, false)).toEqual({ kind: "silent" });
    expect(decideEntry("off", null, true)).toEqual({ kind: "silent" });
    expect(decideEntry("off", activeProjection(), true)).toEqual({
      kind: "silent",
    });
  });

  it("ordinary Q&A without an active task stays silent", () => {
    expect(decideEntry("ask", null, false)).toEqual({ kind: "silent" });
    expect(decideEntry("always", null, false)).toEqual({ kind: "silent" });
  });

  it("ask + durable request asks once to create a task card", () => {
    expect(decideEntry("ask", null, true)).toEqual({
      kind: "ask-create",
      taskAnchor: null,
    });
  });

  it("always + durable request creates a task card and anchors", () => {
    expect(decideEntry("always", null, true)).toEqual({
      kind: "create-and-anchor",
      taskAnchor: null,
    });
  });

  it("an active task injects the breadcrumb and unique next", () => {
    const projection = activeProjection();
    const decision = decideEntry("ask", projection, false);

    expect(decision).toEqual({
      kind: "inject",
      breadcrumb: projection.breadcrumb,
      next: "tc run T-1 --node execute-1",
    });
  });

  it("falls back to the breadcrumb next command when the projection next is null", () => {
    const projection = activeProjection({ next: null });
    const decision = decideEntry("always", projection, true);

    expect(decision.kind).toBe("inject");
    if (decision.kind === "inject") {
      expect(decision.next).toBe(projection.breadcrumb.next.command);
    }
  });

  it("non-active projections never inject (defensive silence)", () => {
    for (const status of ["waiting", "done", "cancelled", "queued"] as const) {
      expect(decideEntry("always", nonActiveProjection(status), true)).toEqual({
        kind: "silent",
      });
    }
  });
});

describe("runEntryGate IO wrapper", () => {
  it("off produces zero output even without a Task Store", () => {
    const project = createHookProject({ takeOver: "off" }, false);

    try {
      const result = runEntryGate(project.configPath, true);

      expect(result.decision).toEqual({ kind: "silent" });
      expect(result.output).toBeNull();
    } finally {
      project.cleanup();
    }
  });

  it("a project without a Task Store stays silent", () => {
    const project = createHookProject({ takeOver: "always" }, false);

    try {
      const result = runEntryGate(project.configPath, true);

      expect(result.decision).toEqual({ kind: "silent" });
      expect(result.output).toBeNull();
    } finally {
      project.cleanup();
    }
  });

  it("injects exactly one breadcrumb line for an active task", () => {
    const project = createHookProject({ takeOver: "always" }, true);
    const database = createStoreAt(project.databasePath);
    insertTask(database, {
      id: "T-1",
      activatedAt: FIXED_TIMESTAMP,
    });
    insertNode(database, "T-1", "execute-1", "execute");
    database.close();

    try {
      const result = runEntryGate(project.configPath, false);

      expect(result.decision.kind).toBe("inject");
      expect(result.output).toContain("tc-breadcrumb/v1");
      expect(result.output).toContain('"id":"T-1"');
      expect(result.output).toContain("tc run T-1 --node execute-1");
    } finally {
      project.cleanup();
    }
  });

  it("anchors the active L3 root while its current child is also active", () => {
    const project = createHookProject({ takeOver: "always" }, true);
    const database = createStoreAt(project.databasePath);
    const { taskId, planAttemptId } = setupL3ToFeasibility(database);
    const feasibility = reviewStart(
      database,
      taskId,
      reviewInput(taskId, "review-plan-1", planAttemptId, "feasibility"),
    );
    passReview(database, taskId, feasibility.reviewAttemptId, planAttemptId);
    run(database, "T-2");
    database.close();

    try {
      const result = runEntryGate(project.configPath, false);

      expect(result.decision.kind).toBe("inject");
      expect(result.output).toContain('"id":"T-1"');
      expect(result.output).not.toContain('"id":"T-2"');
      expect(result.output).toContain("tc run complete T-2");
    } finally {
      project.cleanup();
    }
  });

  it("a waiting task stays silent (no wrong breadcrumb)", () => {
    const project = createHookProject({ takeOver: "ask" }, true);
    const database = createStoreAt(project.databasePath);
    insertL1Fixture(database);
    database.close();

    try {
      const result = runEntryGate(project.configPath, true);

      expect(result.decision).toEqual({ kind: "silent" });
      expect(result.output).toBeNull();
    } finally {
      project.cleanup();
    }
  });

  it("a queued (never activated) task stays silent", () => {
    const project = createHookProject({ takeOver: "always" }, true);
    const database = createStoreAt(project.databasePath);
    insertTask(database, { id: "T-2" });
    database.close();

    try {
      const result = runEntryGate(project.configPath, false);

      expect(result.decision).toEqual({ kind: "silent" });
      expect(result.output).toBeNull();
    } finally {
      project.cleanup();
    }
  });

  it("maps a missing or malformed config to a stable diagnostic", () => {
    for (const config of [null, "not json", { takeOver: "bogus" }]) {
      const project = createHookProject(config, false);

      try {
        expect(() => runEntryGate(project.configPath, true)).toThrowError(
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
