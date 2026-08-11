import { describe, expect, it } from "vitest";

import { buildBreadcrumb } from "../../src/core/breadcrumb.js";
import type { BreadcrumbInput } from "../../src/core/breadcrumb.js";
import { createContractValidators } from "../../src/contracts/schemas.js";

const ANCHOR: BreadcrumbInput["task"] = {
  id: "T-201",
  level: 1,
  status: "active",
  taskRevision: 2,
  lifecycleRevision: 1,
  waitingReason: null,
  node: "execute-1",
  nodeKind: "execute",
};

describe("buildBreadcrumb", () => {
  it("constructs a document that passes the frozen breadcrumb schema", () => {
    const validators = createContractValidators();
    const breadcrumb = buildBreadcrumb({
      task: ANCHOR,
      nextCommand: "tc run complete T-201",
    });

    expect(validators.breadcrumb(breadcrumb)).toBe(true);
    expect(validators.breadcrumb.errors).toBeNull();
    expect(breadcrumb.schemaVersion).toBe("tc-breadcrumb/v1");
    expect(breadcrumb.takeover).toBe("active");
    expect(breadcrumb.next).toEqual({ command: "tc run complete T-201" });
    expect(breadcrumb.detailCommand).toBe("tc task show T-201 --json");
  });

  it("falls back to the detail command when there is no next command", () => {
    const breadcrumb = buildBreadcrumb({
      task: { ...ANCHOR, status: "done", node: null, nodeKind: null },
      nextCommand: null,
    });

    expect(breadcrumb.next).toEqual({ command: "tc task show T-201 --json" });
  });

  it("includes the typed waitingReason for waiting tasks as the schema requires", () => {
    const validators = createContractValidators();
    const breadcrumb = buildBreadcrumb({
      task: {
        ...ANCHOR,
        status: "waiting",
        waitingReason: "failed_retries_exhausted",
        node: null,
        nodeKind: null,
      },
      nextCommand: null,
      blocked: ["failed_retries_exhausted"],
    });

    expect(validators.breadcrumb(breadcrumb)).toBe(true);
    expect(validators.breadcrumb.errors).toBeNull();
    expect(breadcrumb.task!.waitingReason).toBe("failed_retries_exhausted");
    expect(breadcrumb.blocked).toEqual(["failed_retries_exhausted"]);
  });

  it("rejects a waiting task without a waitingReason under the frozen schema", () => {
    const validators = createContractValidators();
    const breadcrumb = buildBreadcrumb({
      task: { ...ANCHOR, status: "waiting", node: null, nodeKind: null },
      nextCommand: null,
    });

    expect(validators.breadcrumb(breadcrumb)).toBe(false);
  });
});
