import { describe, expect, it } from "vitest";

import { buildTaskShowData } from "../../src/commands/task-show.js";
import { ERROR_CODES } from "../../src/core/errors.js";
import { run, runComplete, taskNew } from "../../src/core/reducer.js";
import { buildTaskDetail } from "../../src/watch/routes.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";

const DELIVERY_BINDING = {
  specId: "engineering.delivery",
  kind: "engineering" as const,
  path: "docs/delivery.md",
  duty: "required" as const,
};

const DELIVERED = {
  summary: "Delivered",
  evidence: [
    {
      type: "validation",
      reference: "tests/spec/delivery.test.ts",
      summary: "Validated",
    },
  ],
  record: {
    summary: "Recorded",
    specImpact: { outcome: "none" as const, reason: "No reusable rule" },
  },
};

describe("shared Spec delivery view", () => {
  it("feeds task show and Watch the same bindings and Impact DTO", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Shared DTO",
        level: 1,
        reason: "CLI and Watch must agree",
        initialSpecBindings: [DELIVERY_BINDING],
      });
      run(database, taskId);
      runComplete(database, taskId, { result: DELIVERED });

      const taskShow = buildTaskShowData(database, taskId);
      const watch = buildTaskDetail(database, taskId)!;

      expect(taskShow.specs).toEqual(watch.specs);
      expect(taskShow.specs.bindings).toHaveLength(2);
      // The recorded binding is exactly what the Store holds: no hash of the
      // document it names and no drift verdict against today's Registry.
      expect(taskShow.specs.bindings[0]).toEqual({
        lifecycleRevision: 1,
        nodeId: "execute-1",
        id: "engineering.delivery",
        kind: "engineering",
        path: "docs/delivery.md",
        duty: "required",
        sourceKind: "task_create",
        sourceTaskId: null,
        sourceAttemptId: null,
      });
      expect(taskShow.specs.impacts[0]?.result).toEqual({
        outcome: "none",
        reason: "No reusable rule",
      });
    } finally {
      database.close();
    }
  });

  it("renders the recorded binding without consulting the document", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Store projection",
        level: 1,
        reason: "a binding is a Store fact",
        initialSpecBindings: [DELIVERY_BINDING],
      });

      const before = buildTaskShowData(database, taskId).specs;
      // Nothing named docs/delivery.md exists anywhere, and no Registry is
      // readable. Neither is a property of the recorded binding, so neither may
      // change what the card renders.
      expect(buildTaskShowData(database, taskId).specs).toEqual(before);
      expect(buildTaskDetail(database, taskId)!.specs).toEqual(before);
    } finally {
      database.close();
    }
  });

  it("fails task show and Watch with the same stable error for damaged Impact details", () => {
    const database = createMigratedDatabase();
    try {
      const { taskId } = taskNew(database, {
        title: "Damaged Impact",
        level: 1,
        reason: "stable shared failure",
      });
      run(database, taskId);
      runComplete(database, taskId, { result: DELIVERED });
      database.exec("DROP TRIGGER spec_impact_results_immutable_update");
      database
        .prepare("UPDATE spec_impact_results SET details_json = 'not-json'")
        .run();

      const taskShowError = captureTaskcraftError(() =>
        buildTaskShowData(database, taskId),
      );
      const watchError = captureTaskcraftError(() =>
        buildTaskDetail(database, taskId),
      );

      expect(taskShowError.code).toBe(ERROR_CODES.TC_SPEC_IMPACT_INVALID);
      expect(watchError.code).toBe(ERROR_CODES.TC_SPEC_IMPACT_INVALID);
      expect(taskShowError.problem).toBe(watchError.problem);
    } finally {
      database.close();
    }
  });
});
