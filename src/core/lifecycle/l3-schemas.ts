import { SPEC_SELECTION_ARRAY_SCHEMA } from "./spec-schemas.js";

const MODULE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "key",
    "title",
    "level",
    "reason",
    "objective",
    "scope",
    "acceptance",
    "nonGoals",
    "covers",
    "reviewFocus",
    "specBindings",
  ],
  properties: {
    key: { type: "string", minLength: 1 },
    reuseTaskId: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    level: { type: "integer", enum: [1, 2] },
    reason: { type: "string", minLength: 1 },
    objective: { type: "string", minLength: 1 },
    scope: { type: "array", items: { type: "string", minLength: 1 } },
    acceptance: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
    },
    nonGoals: { type: "array", items: { type: "string", minLength: 1 } },
    covers: { type: "array", items: { type: "string", minLength: 1 } },
    reviewFocus: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    specBindings: SPEC_SELECTION_ARRAY_SCHEMA,
  },
} as const;

export const L3_FRAME_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["objective", "scope", "acceptanceAnchors", "nonGoals"],
  properties: {
    objective: { type: "string", minLength: 1 },
    scope: { type: "array", items: { type: "string", minLength: 1 } },
    acceptanceAnchors: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        properties: {
          id: { type: "string", minLength: 1 },
          text: { type: "string", minLength: 1 },
        },
      },
    },
    nonGoals: { type: "array", items: { type: "string", minLength: 1 } },
  },
} as const;

export const L3_PLAN_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "decomposition",
    "modules",
    "coverage",
    "dependencies",
    "executionMode",
    "sharedValidations",
    "integrationPath",
    "executionSpecs",
  ],
  properties: {
    decomposition: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "reason", "attemptedSplits"],
      properties: {
        mode: { type: "string", enum: ["modules", "single"] },
        reason: { type: "string", minLength: 1 },
        attemptedSplits: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["proposal", "failureReason"],
            properties: {
              proposal: { type: "string", minLength: 1 },
              failureReason: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
    modules: { type: "array", items: MODULE_SCHEMA },
    coverage: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["anchorId", "disposition", "moduleKeys"],
        properties: {
          anchorId: { type: "string", minLength: 1 },
          disposition: {
            type: "string",
            enum: ["required", "deferred", "descope"],
          },
          moduleKeys: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
          reason: { type: "string", minLength: 1 },
        },
      },
    },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task", "dependsOn"],
        properties: {
          task: { type: "string", minLength: 1 },
          dependsOn: { type: "string", minLength: 1 },
        },
      },
    },
    executionMode: { type: "string", enum: ["serial", "parallel", "hybrid"] },
    sharedValidations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "reference", "owner"],
        properties: {
          id: { type: "string", minLength: 1 },
          reference: { type: "string", minLength: 1 },
          owner: { type: "string", minLength: 1 },
        },
      },
    },
    integrationPath: { type: "string", minLength: 1 },
    executionSpecs: SPEC_SELECTION_ARRAY_SCHEMA,
  },
} as const;

export const L3_INTEGRATE_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["childrenResults", "integrationEvidence"],
  properties: {
    childrenResults: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "taskRevision", "evidenceRefs"],
        properties: {
          taskId: { type: "string", minLength: 1 },
          taskRevision: { type: "integer", minimum: 1 },
          evidenceRefs: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
    integrationEvidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "reference", "summary"],
        properties: {
          type: {
            type: "string",
            enum: ["validation", "test", "artifact", "note"],
          },
          reference: { type: "string", minLength: 1 },
          summary: { type: "string", minLength: 1 },
          digest: { type: "string" },
        },
      },
    },
    modifiedDeliverables: { type: "boolean" },
  },
} as const;
