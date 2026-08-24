import { describe, expect, it } from "vitest";

import { renderTaskDetail } from "../../watch/detail.js";
import { buildDetail } from "./frontend-detail-fixture.js";

const TIMESTAMP = "2026-08-11T00:00:00.000Z";

describe("renderTaskDetail Specs", () => {
  it("renders Registry issues, binding drift and typed Spec Impact without inference", () => {
    const html = renderTaskDetail(
      buildDetail({
        specs: {
          registryIssue: {
            code: "TC_SPEC_REGISTRY_INVALID",
            problem: "Registry <broken>",
            remediation: "Repair the Registry",
          },
          bindings: [
            {
              lifecycleRevision: 2,
              nodeId: "execute-1",
              id: "engineering.delivery",
              kind: "engineering",
              path: "docs/delivery.md",
              digest: "a".repeat(64),
              duty: "required",
              sourceKind: "frame",
              sourceTaskId: "T-1",
              sourceAttemptId: "att-frame-1",
              drift: { status: "stale", reasons: ["digest_changed"] },
            },
          ],
          impacts: [
            {
              recordAttemptId: "att-record-1",
              lifecycleRevision: 2,
              recordNodeId: "record-1",
              result: {
                outcome: "candidate",
                candidates: [
                  {
                    kind: "domain",
                    title: "Owner approval",
                    rule: "Require owner confirmation",
                    reason: "Not established by code",
                    ownerDecision: "Accept or reject",
                  },
                ],
              },
              createdBy: "actor-1",
              createdAt: TIMESTAMP,
            },
          ],
        },
      }),
    );

    expect(html).toContain('data-section="specs"');
    expect(html).toContain('data-testid="spec-binding-table"');
    expect(html).toContain("engineering.delivery");
    expect(html).toContain("digest_changed");
    expect(html).toContain('data-spec-impact="candidate"');
    expect(html).toContain("ownerDecision");
    expect(html).toContain("Registry &lt;broken&gt;");
    expect(html).not.toContain("Registry <broken>");
  });

  it("renders all Impact states and empty Specs without exposing HTML", () => {
    const empty = renderTaskDetail(buildDetail());
    expect(empty).toContain("No Specs bound to this lifecycle revision");
    expect(empty).toContain("No Spec Impact recorded");

    const html = renderTaskDetail(
      buildDetail({
        specs: {
          registryIssue: null,
          bindings: [],
          impacts: [
            {
              recordAttemptId: "att-none",
              lifecycleRevision: 2,
              recordNodeId: "record-1",
              result: { outcome: "none", reason: "<img src=x>" },
              createdBy: "actor-1",
              createdAt: TIMESTAMP,
            },
            {
              recordAttemptId: "att-updated",
              lifecycleRevision: 2,
              recordNodeId: "record-1",
              result: {
                outcome: "updated",
                updates: [
                  {
                    specId: "engineering.delivery",
                    path: "docs/<delivery>.md",
                    digest: "a".repeat(64),
                    evidenceRefs: ["ev-1"],
                  },
                ],
              },
              createdBy: "actor-1",
              createdAt: TIMESTAMP,
            },
            {
              recordAttemptId: "att-candidate",
              lifecycleRevision: 2,
              recordNodeId: "record-1",
              result: {
                outcome: "candidate",
                candidates: [
                  {
                    kind: "domain",
                    title: "Owner decision",
                    rule: "Do not execute <script>alert(1)</script>",
                    reason: "Needs authority",
                    ownerDecision: "Accept or reject",
                  },
                ],
              },
              createdBy: "actor-1",
              createdAt: TIMESTAMP,
            },
          ],
        },
      }),
    );

    for (const outcome of ["none", "updated", "candidate"]) {
      expect(html).toContain(`data-spec-impact="${outcome}"`);
    }
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
