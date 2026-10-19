// Pure Node Brief rendering for hosts (architecture.md §9 / lifecycle.md
// §7.1). Consumes only the projector/reducer Node Brief data plus the host
// identity and known capabilities; never performs IO. Both adapters render
// through this single source so codex and claude produce identical output
// for identical input.

import type { NodeBrief } from "./reducer.js";

export const NODE_BRIEF_SCHEMA_VERSION = "tc-node-brief/v1";

export interface NodeBriefHostCapability {
  name: string;
  available: boolean;
  limitation?: string;
}

export interface NodeBriefInput {
  host: string;
  hostVersion?: string | null;
  hostCapabilities?: readonly NodeBriefHostCapability[];
  /** Optional dispatch notes: whether the host can delegate subagents and
   * how Taskcraft expects them used. */
  dispatchNotes?: readonly string[];
  brief: NodeBrief;
}

export interface RenderedNodeBrief {
  schemaVersion: typeof NODE_BRIEF_SCHEMA_VERSION;
  host: string;
  /** Host-readable markdown text block. */
  text: string;
  /** Machine format: pass-through brief data plus a host header. */
  json: unknown;
}

export function renderNodeBrief(input: NodeBriefInput): RenderedNodeBrief {
  const capabilities = input.hostCapabilities ?? [];

  return {
    schemaVersion: NODE_BRIEF_SCHEMA_VERSION,
    host: input.host,
    text: renderText(input, capabilities),
    json: {
      schemaVersion: NODE_BRIEF_SCHEMA_VERSION,
      host: {
        id: input.host,
        version: input.hostVersion ?? null,
        capabilities,
      },
      dispatchNotes: input.dispatchNotes ?? [],
      brief: input.brief,
    },
  };
}

function renderText(
  input: NodeBriefInput,
  capabilities: readonly NodeBriefHostCapability[],
): string {
  const { brief } = input;
  const version =
    input.hostVersion === null || input.hostVersion === undefined
      ? ""
      : ` (${input.hostVersion})`;
  const obligations = brief.obligations
    .map(
      (obligation) =>
        `- [${obligation.duty}] ${obligation.title} (${obligation.id})`,
    )
    .join("\n");
  const capabilityLines = capabilities
    .map((item) => {
      const status = item.available ? "available" : "unavailable";
      return item.limitation === undefined
        ? `- ${item.name}: ${status}`
        : `- ${item.name}: ${status} (${item.limitation})`;
    })
    .join("\n");
  const dispatch =
    (input.dispatchNotes ?? []).length === 0
      ? ""
      : `\nDispatch notes:\n${(input.dispatchNotes ?? [])
          .map((note) => `- ${note}`)
          .join("\n")}`;
  const specs =
    brief.specs.length === 0
      ? "- (none)"
      : brief.specs
          .map(
            (spec) =>
              `- [${spec.duty}] ${spec.id} (${spec.kind}) — ${spec.path}`,
          )
          .join("\n");
  const review =
    brief.reviewContext === null
      ? ""
      : [
          "",
          "Reviewed attempt:",
          `- Purpose: ${brief.reviewContext.purpose}`,
          `- Attempt: ${brief.reviewContext.reviewedAttemptId}`,
          `- Node: ${brief.reviewContext.reviewedNodeId} (${brief.reviewContext.reviewedNodeKind})`,
          `- Outcome: ${brief.reviewContext.outcome}`,
          `- Result: ${JSON.stringify(brief.reviewContext.result)}`,
          "- Evidence:",
          ...(brief.reviewContext.evidence.length === 0
            ? ["  - (none)"]
            : brief.reviewContext.evidence.map(
                (item) =>
                  `  - ${item.id} (${item.type}) — ${item.reference} — ${item.summary}` +
                  (item.digest === null ? "" : ` — digest:${item.digest}`),
              )),
        ].join("\n");

  return [
    "## Taskcraft Node Brief",
    "",
    `Host: ${input.host}${version}`,
    `Task: ${brief.taskId} — ${brief.taskTitle}`,
    `Task revision: ${brief.taskRevision}`,
    `Lifecycle revision: ${brief.lifecycleRevision}`,
    `Node: ${brief.nodeId} (${brief.nodeKind}) — attempt ${brief.attemptId}`,
    "",
    `Objective: ${brief.objective}`,
    `Procedure: ${brief.procedureRef}`,
    "",
    "Obligations:",
    obligations,
    "",
    "Specs:",
    specs,
    review,
    "",
    "Result schema:",
    "```json",
    brief.resultSchemaJson,
    "```",
    "",
    `Registered command: ${brief.nextCommand}`,
    "",
    "Host capabilities:",
    capabilityLines,
    dispatch,
  ].join("\n");
}
