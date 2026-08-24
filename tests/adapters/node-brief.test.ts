import { describe, expect, it } from "vitest";

import { createClaudeAdapter } from "../../src/adapters/claude.js";
import { createCodexAdapter } from "../../src/adapters/codex.js";
import type { NodeBriefInput } from "../../src/core/node-brief.js";
import { createFakeHost } from "../helpers/fake-host.js";

describe("host Node Brief Spec delivery", () => {
  it("keeps the Codex and Claude Spec contract byte-identical", () => {
    const fake = createFakeHost();
    const brief: NodeBriefInput["brief"] = {
      taskId: "T-1",
      taskTitle: "Shared delivery",
      taskRevision: 7,
      lifecycleRevision: 2,
      nodeId: "review-1",
      nodeKind: "review",
      attemptId: "att-review-1",
      objective: "Review the delivery",
      procedureRef: "l2:review",
      obligations: [
        { id: "review", duty: "required", title: "Review completed" },
      ],
      specs: [
        {
          id: "engineering.delivery",
          kind: "engineering",
          duty: "required",
          path: "docs/delivery.md",
          digest: "a".repeat(64),
          drift: { status: "current", reasons: [] },
        },
      ],
      reviewContext: {
        purpose: "delivery",
        reviewedAttemptId: "att-execute-1",
        reviewedNodeId: "execute-1",
        reviewedNodeKind: "execute",
        attemptNumber: 1,
        outcome: "success",
        result: { summary: "Delivered" },
        evidence: [
          {
            id: "ev-1",
            type: "validation",
            reference: "tests/delivery.test.ts",
            summary: "Passed",
            digest: null,
          },
        ],
      },
      resultSchemaJson: '{"type":"object"}',
      nextCommand: "tc review pass T-1 --attempt att-review-1",
    };

    const codex = createCodexAdapter(fake.deps()).renderNodeBrief({
      host: "codex",
      brief,
    });
    const claude = createClaudeAdapter(fake.deps()).renderNodeBrief({
      host: "claude",
      brief,
    });

    expect(extractBrief(codex.json)).toEqual(brief);
    expect(extractBrief(claude.json)).toEqual(brief);
    expect(specLines(codex.text)).toEqual(specLines(claude.text));
    expect(reviewLines(codex.text)).toEqual(reviewLines(claude.text));
    expect(codex.text).toContain(
      "ev-1 (validation) — tests/delivery.test.ts — Passed",
    );
    expect(codex.text).toContain("Task revision: 7");
    expect(codex.text).toContain("Lifecycle revision: 2");
  });
});

function extractBrief(value: unknown): unknown {
  return (value as { brief: unknown }).brief;
}

function specLines(text: string): string[] {
  return text
    .split("\n")
    .filter(
      (line) =>
        line === "Specs:" ||
        line.includes("engineering.delivery") ||
        line.includes("docs/delivery.md"),
    );
}

function reviewLines(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf("Reviewed attempt:");
  const end = lines.indexOf("Result schema:");
  return lines.slice(start, end);
}
