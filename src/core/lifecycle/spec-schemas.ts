export const SPEC_SELECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "duty"],
  properties: {
    id: { type: "string", minLength: 1 },
    duty: { type: "string", enum: ["required", "recommended"] },
  },
} as const;

export const SPEC_SELECTION_ARRAY_SCHEMA = {
  type: "array",
  items: SPEC_SELECTION_SCHEMA,
} as const;
