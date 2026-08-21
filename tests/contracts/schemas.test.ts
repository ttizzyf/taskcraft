import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createContractValidators,
  loadJsonFile,
  loadL2TaskFixture,
  loadSpecRegistryFixture,
} from "../../src/contracts/schemas.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

const validLifecycle = {
  schemaVersion: "tc-lifecycle/v1",
  taskId: "T-104",
  revision: 1,
  reasonCode: "initial",
  reason: "Initial lifecycle",
  compilerVersion: "1.0.0",
  factsDigest: "facts",
  policyDigest: "policy",
  nodes: [
    {
      id: "execute-1",
      kind: "execute",
      title: "Execute",
      objective: "Implement the task",
      procedureRef: "tc://execute",
      scope: {},
      obligations: [],
    },
  ],
  edges: [],
};

const validBreadcrumb = {
  schemaVersion: "tc-breadcrumb/v1",
  takeover: "active",
  task: {
    id: "T-104",
    level: 2,
    status: "active",
    taskRevision: 12,
    lifecycleRevision: 1,
    node: "execute-1",
    nodeKind: "execute",
    waitingReason: null,
  },
  next: { command: "tc task next T-104 --json" },
};

describe("Taskcraft JSON contracts", () => {
  it("compiles all Draft 2020-12 schemas in strict mode", () => {
    const validators = createContractValidators();
    const specRegistry = loadSpecRegistryFixture();

    expect(validators.lifecycle(validLifecycle)).toBe(true);
    expect(validators.lifecycle.errors).toBeNull();
    expect(validators.breadcrumb(validBreadcrumb)).toBe(true);
    expect(validators.breadcrumb.errors).toBeNull();
    expect(validators.specRegistry(specRegistry)).toBe(true);
    expect(validators.specRegistry.errors).toBeNull();
  });

  it("exposes validation failures for invalid instances", () => {
    const validators = createContractValidators();
    const invalidLifecycle = { ...validLifecycle, revision: 0 };
    const invalidBreadcrumb = {
      ...validBreadcrumb,
      task: { ...validBreadcrumb.task, level: 4 },
    };
    const invalidSpecRegistry = {
      schemaVersion: "tc-spec-registry/v1",
      specs: [
        {
          id: "domain.refunds",
          kind: "domain",
          path: "docs/refunds.md",
          summary: "Refund rules",
          appliesTo: ["src/refunds/**"],
          status: "active",
        },
      ],
    };

    expect(validators.lifecycle(invalidLifecycle)).toBe(false);
    expect(validators.lifecycle.errors).not.toBeNull();
    expect(validators.breadcrumb(invalidBreadcrumb)).toBe(false);
    expect(validators.breadcrumb.errors).not.toBeNull();
    expect(validators.specRegistry(invalidSpecRegistry)).toBe(false);
    expect(validators.specRegistry.errors).not.toBeNull();
  });

  it("parses the L2 task fixture without applying an unrelated schema", () => {
    const fixture = loadL2TaskFixture();

    expect(fixture).toMatchObject({
      schemaVersion: "tc-task/v1",
      id: "T-104",
      level: 2,
    });
  });

  it("preserves JSON parse errors", () => {
    const temporaryDirectory = createTemporaryDirectory();
    const invalidJsonPath = join(temporaryDirectory.path, "invalid.json");
    writeFileSync(invalidJsonPath, "{not-json", "utf8");

    try {
      expect(() => loadJsonFile(invalidJsonPath)).toThrow(SyntaxError);
    } finally {
      temporaryDirectory.cleanup();
    }
  });
});
