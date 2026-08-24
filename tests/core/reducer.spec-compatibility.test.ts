import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { L3_PLAN_RESULT_SCHEMA } from "../../src/core/lifecycle/l3.js";
import {
  LEGACY_L1_EXECUTE_RESULT_SCHEMA,
  LEGACY_L1_RECORD_RESULT_SCHEMA,
} from "../../src/core/lifecycle/l1.js";
import {
  reviewPass,
  reviewStart,
  run,
  runComplete,
  taskNew,
} from "../../src/core/reducer.js";
import {
  getLifecycleSpecBindings,
  getTaskRelations,
  listTasks,
} from "../../src/store/query.js";
import {
  captureTaskcraftError,
  createMigratedDatabase,
} from "../store/helpers.js";
import { L3_FRAME_RESULT, L3_PLAN_RESULT, reviewInput } from "./l3-utils.js";

const STORE_SPEC = {
  specId: "engineering.store",
  kind: "engineering" as const,
  path: "docs/store.md",
  digest: "a".repeat(64),
  duty: "required" as const,
};

describe("Spec binding compiler compatibility", () => {
  it("uses the new compiler versions only for newly materialized revisions", () => {
    const database = createMigratedDatabase();
    try {
      const l1 = taskNew(database, { title: "L1", level: 1, reason: "new" });
      const l2 = taskNew(database, { title: "L2", level: 2, reason: "new" });
      const l3 = taskNew(database, { title: "L3", level: 3, reason: "new" });
      const rows = database
        .prepare(
          `SELECT task_id AS taskId, compiler_version AS compilerVersion
           FROM lifecycle_revisions WHERE revision = 1 ORDER BY task_id`,
        )
        .all();

      expect(rows).toEqual([
        { taskId: l1.taskId, compilerVersion: "tc-l1/3" },
        { taskId: l2.taskId, compilerVersion: "tc-l2/3" },
        { taskId: l3.taskId, compilerVersion: "tc-l3/4" },
      ]);
    } finally {
      database.close();
    }
  });

  it("rejects malformed resolved snapshots before creating a task", () => {
    const database = createMigratedDatabase();
    try {
      const error = captureTaskcraftError(() =>
        taskNew(database, {
          title: "Malformed snapshot",
          level: 1,
          reason: "boundary validation",
          initialSpecBindings: [
            {
              ...STORE_SPEC,
              specId: "Engineering Store",
              unexpected: true,
            } as typeof STORE_SPEC,
          ],
        }),
      );

      expect(error.code).toBe(ERROR_CODES.TC_SPEC_BINDING_INVALID);
      expect(listTasks(database)).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("keeps legacy L1/1, L2/1, L3/2 and child/1 contracts completable", () => {
    const database = createMigratedDatabase();
    try {
      // These bytes would have been written before the compiler bump. The
      // fixture drops only update guards instead of shipping legacy writers.
      database.exec(
        "DROP TRIGGER lifecycle_revisions_immutable_update; DROP TRIGGER lifecycle_nodes_immutable_update; DROP TRIGGER obligation_definitions_immutable_delete;",
      );
      const l1 = taskNew(database, {
        title: "Legacy L1",
        level: 1,
        reason: "stored contract",
      });
      database
        .prepare(
          "UPDATE lifecycle_revisions SET compiler_version = 'tc-l1/1' WHERE task_id = ? AND revision = 1",
        )
        .run(l1.taskId);
      database
        .prepare(
          `UPDATE lifecycle_nodes SET output_schema_json = CASE id
             WHEN 'execute-1' THEN ? WHEN 'record-1' THEN ? ELSE output_schema_json END
           WHERE task_id = ? AND lifecycle_revision = 1`,
        )
        .run(
          JSON.stringify(LEGACY_L1_EXECUTE_RESULT_SCHEMA),
          JSON.stringify(LEGACY_L1_RECORD_RESULT_SCHEMA),
          l1.taskId,
        );
      database
        .prepare(
          `DELETE FROM obligation_definitions
           WHERE task_id = ? AND lifecycle_revision = 1 AND id = 'spec-impact-recorded'`,
        )
        .run(l1.taskId);
      run(database, l1.taskId);
      expect(
        runComplete(database, l1.taskId, {
          result: {
            summary: "Legacy delivery",
            evidence: [
              {
                type: "validation",
                reference: "ref://legacy",
                summary: "Validated",
              },
            ],
            record: { summary: "Legacy record" },
          },
        }).status,
      ).toBe("done");
      expect(getLifecycleSpecBindings(database, l1.taskId)).toEqual([]);

      const l2 = taskNew(database, {
        title: "Legacy L2",
        level: 2,
        reason: "stored contract",
      });
      database
        .prepare(
          "UPDATE lifecycle_revisions SET compiler_version = 'tc-l2/1' WHERE task_id = ? AND revision = 1",
        )
        .run(l2.taskId);
      database
        .prepare(
          `UPDATE lifecycle_nodes SET output_schema_json = ?
           WHERE task_id = ? AND lifecycle_revision = 1 AND id = 'frame-1'`,
        )
        .run(JSON.stringify(legacyL2FrameSchema()), l2.taskId);
      run(database, l2.taskId, { nodeId: "frame-1" });
      runComplete(database, l2.taskId, {
        nodeId: "frame-1",
        result: {
          objective: "Legacy frame",
          scope: {},
          acceptance: ["Old schema remains valid"],
        },
      });
      expect(getLifecycleSpecBindings(database, l2.taskId)).toEqual([]);

      const l3 = taskNew(database, {
        title: "Legacy modular L3",
        level: 3,
        reason: "stored contract",
      });
      database
        .prepare(
          "UPDATE lifecycle_revisions SET compiler_version = 'tc-l3/2' WHERE task_id = ? AND revision = 1",
        )
        .run(l3.taskId);
      database
        .prepare(
          `UPDATE lifecycle_nodes SET output_schema_json = ?
           WHERE task_id = ? AND lifecycle_revision = 1 AND id = 'plan-1'`,
        )
        .run(JSON.stringify(legacyL3PlanSchema()), l3.taskId);
      run(database, l3.taskId, { nodeId: "frame-1" });
      runComplete(database, l3.taskId, {
        nodeId: "frame-1",
        result: L3_FRAME_RESULT,
      });
      run(database, l3.taskId, { nodeId: "plan-1" });
      const legacyPlan = {
        ...L3_PLAN_RESULT,
        modules: L3_PLAN_RESULT.modules.map((module) => {
          const copy = { ...module } as Partial<typeof module>;
          delete copy.specBindings;
          return copy;
        }),
      } as Record<string, unknown>;
      delete legacyPlan.executionSpecs;
      runComplete(database, l3.taskId, {
        nodeId: "plan-1",
        result: legacyPlan,
      });
      const legacyPlanAttempt = `att-${l3.taskId}-plan-1-1`;
      const review = reviewStart(
        database,
        l3.taskId,
        reviewInput(
          l3.taskId,
          "review-plan-1",
          legacyPlanAttempt,
          "feasibility",
        ),
      );
      reviewPass(database, l3.taskId, {
        taskId: l3.taskId,
        attemptId: review.reviewAttemptId,
        reviewedAttemptId: legacyPlanAttempt,
        evidence: [
          { type: "validation", reference: "ref://review", summary: "valid" },
        ],
      });

      expect(compilerVersion(database, l3.taskId, 2)).toBe("tc-l3/2");
      const children = getTaskRelations(database, l3.taskId, 2).children;
      expect(children).toHaveLength(2);
      for (const child of children) {
        expect(compilerVersion(database, child.childTaskId, 1)).toBe(
          "tc-l3-child/1",
        );
        expect(getLifecycleSpecBindings(database, child.childTaskId)).toEqual(
          [],
        );
      }
    } finally {
      database.close();
    }
  });
});

function compilerVersion(
  database: ReturnType<typeof createMigratedDatabase>,
  taskId: string,
  revision: number,
): string {
  return (
    database
      .prepare(
        "SELECT compiler_version AS compilerVersion FROM lifecycle_revisions WHERE task_id = ? AND revision = ?",
      )
      .get(taskId, revision) as { compilerVersion: string }
  ).compilerVersion;
}

function legacyL2FrameSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["objective", "scope", "acceptance"],
    properties: {
      objective: { type: "string", minLength: 1 },
      scope: { type: "object" },
      acceptance: {
        type: "array",
        items: { type: "string", minLength: 1 },
      },
    },
  };
}

function legacyL3PlanSchema(): Record<string, unknown> {
  const schema = structuredClone(L3_PLAN_RESULT_SCHEMA) as unknown as {
    required: string[];
    properties: {
      executionSpecs?: unknown;
      modules: {
        items: {
          required: string[];
          properties: { specBindings?: unknown };
        };
      };
    };
  };
  schema.required = schema.required.filter((key) => key !== "executionSpecs");
  delete schema.properties.executionSpecs;
  schema.properties.modules.items.required =
    schema.properties.modules.items.required.filter(
      (key) => key !== "specBindings",
    );
  delete schema.properties.modules.items.properties.specBindings;
  return schema as unknown as Record<string, unknown>;
}
