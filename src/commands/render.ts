// Text renderer. Every render function consumes plain data produced by the
// projector / query model (or the reducer's command data); there is no second
// derivation of task state here, so text and JSON always stay in sync.

import type { BreadcrumbV1 } from "../core/breadcrumb.js";
import type {
  CommandData,
  NodeBrief,
  ReviewResultData,
} from "../core/reducer.js";
import type {
  ChildProjection,
  NodeProjection,
  ProjectStatus,
  Projection,
  RunnableWorkItem,
} from "../core/projector.js";
import type {
  AttemptOutcome,
  AttemptStatus,
  BlockerWaitingReason,
  ReviewCapability,
  ReviewIndependenceStatus,
  ReviewPurpose,
} from "../store/query.js";
import { renderL3TaskShowSections } from "./render-l3.js";
import type { SpecDeliveryView } from "../spec/index.js";
import { renderSpecDelivery } from "./render-spec.js";

/** Data shapes shared by the command actions; the renderers only read these. */
export interface TaskNextData extends CommandData {
  nodes: NodeProjection[];
  runnableWorkItems: RunnableWorkItem[];
}

export interface AttemptSummary {
  id: string;
  lifecycleRevision: number;
  nodeId: string;
  attemptNumber: number;
  status: AttemptStatus;
  outcome: AttemptOutcome | null;
  resultJson: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface FindingSummary {
  id: string;
  reviewAttemptId: string;
  severity: "blocking" | "advisory";
  disposition: "open" | "resolved" | "accepted";
  summary: string;
}

export interface EvidenceSummary {
  id: string;
  type: string;
  reference: string;
  summary: string;
  nodeAttemptId: string | null;
}

export interface FactSummary {
  id: string;
  category: string;
  subject: string;
  value: unknown;
  sourceAttemptId: string;
  supersedesFactId: string | null;
  createdAt: string;
}

export interface TaskShowData {
  taskId: string;
  title: string;
  level: 1 | 2 | 3;
  status: ProjectStatus;
  taskRevision: number;
  lifecycleRevision: number;
  parentTaskId: string | null;
  objective: string;
  scope: unknown;
  acceptance: unknown[];
  createdAt: string;
  waitingReason: BlockerWaitingReason | null;
  next: string | null;
  attempts: AttemptSummary[];
  evidence: EvidenceSummary[];
  facts: FactSummary[];
  findings: FindingSummary[];
  breadcrumb: BreadcrumbV1;
  children: ChildProjection[];
  anchors: Projection["anchors"];
  coverage: Projection["coverage"];
  dependencies: Projection["dependencies"];
  validations: Projection["validations"];
  executionSource: Projection["executionSource"];
  inheritedPlanning: Projection["inheritedPlanning"];
  specs: SpecDeliveryView;
}

export interface StatusDetailData {
  taskId: string;
  title: string;
  status: ProjectStatus;
  taskRevision: number;
  waitingReason: BlockerWaitingReason | null;
  next: string | null;
  nodes: NodeProjection[];
  doneObligations: number;
  totalObligations: number;
  breadcrumb: BreadcrumbV1;
}

export interface StatusTaskEntry {
  taskId: string;
  title: string;
  status: ProjectStatus;
  taskRevision: number;
  next: string | null;
}

export interface StatusData {
  currentTask: StatusDetailData | null;
  tasks: StatusTaskEntry[];
}

export interface TaskListEntry {
  taskId: string;
  title: string;
  level: 1 | 2 | 3;
  status: ProjectStatus;
  taskRevision: number;
  parentTaskId: string | null;
  waitingReason: BlockerWaitingReason | null;
  next: string | null;
}

export function renderCommandData(data: CommandData): string {
  const lines = [
    `Task: ${data.taskId}`,
    `Revision: ${data.taskRevision}`,
    `Status: ${data.status}`,
  ];

  if (data.waitingReason !== null) {
    lines.push(`Waiting: ${data.waitingReason}`);
  }

  lines.push(`Next: ${data.next ?? "(none)"}`);
  return lines.join("\n");
}

export function renderNodeBrief(brief: NodeBrief): string {
  const schema = JSON.parse(brief.resultSchemaJson) as unknown;
  const lines = [
    "Node Brief",
    `Task: ${brief.taskId} (${brief.taskTitle})`,
    `Task revision: ${brief.taskRevision}`,
    `Lifecycle revision: ${brief.lifecycleRevision}`,
    `Node: ${brief.nodeId} (${brief.nodeKind})`,
    `Attempt: ${brief.attemptId}`,
    `Objective: ${brief.objective}`,
    `Procedure: ${brief.procedureRef}`,
    "Obligations:",
    ...brief.obligations.map(
      (obligation) =>
        `  - ${obligation.id} (${obligation.duty}): ${obligation.title}`,
    ),
    "Specs:",
    ...(brief.specs.length === 0
      ? ["  (none)"]
      : brief.specs.map((spec) => {
          const drift =
            spec.drift === null
              ? "not checked"
              : spec.drift.status === "current"
                ? "current"
                : `stale: ${spec.drift.reasons.join(", ")}`;
          return `  - ${spec.id} (${spec.kind}, ${spec.duty})  ${spec.path}  sha256:${spec.digest}  ${drift}`;
        })),
    "Result schema:",
    indent(JSON.stringify(schema, null, 2), "  "),
    `Complete command: ${brief.nextCommand}`,
  ];

  if (brief.reviewContext !== null) {
    lines.splice(
      lines.indexOf("Result schema:"),
      0,
      "Reviewed attempt:",
      `  Purpose: ${brief.reviewContext.purpose}`,
      `  Attempt: ${brief.reviewContext.reviewedAttemptId}`,
      `  Node: ${brief.reviewContext.reviewedNodeId} (${brief.reviewContext.reviewedNodeKind})`,
      `  Outcome: ${brief.reviewContext.outcome}`,
      `  Result: ${JSON.stringify(brief.reviewContext.result)}`,
      "  Evidence:",
      ...(brief.reviewContext.evidence.length === 0
        ? ["    (none)"]
        : brief.reviewContext.evidence.map(
            (item) =>
              `    ${item.id} (${item.type})  ${item.reference}  ${item.summary}` +
              (item.digest === null ? "" : `  digest:${item.digest}`),
          )),
    );
  }

  return lines.join("\n");
}

export function renderRunData(data: CommandData): string {
  const lines = [renderCommandData(data)];

  if (data.nodeBrief !== undefined) {
    lines.push("", renderNodeBrief(data.nodeBrief));
  }

  return lines.join("\n");
}

export function renderTaskShowData(data: TaskShowData): string {
  const lines = [
    `Task: ${data.taskId}`,
    `Title: ${data.title}`,
    `Level: ${data.level}`,
    `Status: ${data.status}`,
    `Revision: ${data.taskRevision}`,
    `Parent: ${data.parentTaskId ?? "(none)"}`,
    `Objective: ${data.objective}`,
    `Scope: ${JSON.stringify(data.scope)}`,
    `Acceptance: ${JSON.stringify(data.acceptance)}`,
    `Created: ${data.createdAt}`,
  ];

  if (data.waitingReason !== null) {
    lines.push(`Waiting: ${data.waitingReason}`);
  }

  lines.push(`Next: ${data.next ?? "(none)"}`);
  lines.push(...renderSpecDelivery(data.specs));
  lines.push(...renderL3TaskShowSections(data));
  lines.push("Attempts:");

  if (data.attempts.length === 0) {
    lines.push("  (none)");
  } else {
    for (const attempt of data.attempts) {
      lines.push(
        `  ${attempt.id}  rev ${attempt.lifecycleRevision}  ${attempt.nodeId}  ${attempt.status}` +
          (attempt.outcome === null ? "" : `  ${attempt.outcome}`),
      );
    }
  }

  lines.push("Evidence:");

  if (data.evidence.length === 0) {
    lines.push("  (none)");
  } else {
    for (const evidence of data.evidence) {
      lines.push(
        `  ${evidence.id}  ${evidence.type}  ${evidence.reference}  ${evidence.summary}`,
      );
    }
  }

  lines.push("Facts:");

  if (data.facts.length === 0) {
    lines.push("  (none)");
  } else {
    for (const fact of data.facts) {
      lines.push(
        `  ${fact.id}  ${fact.category}  ${fact.subject}  ${JSON.stringify(fact.value)}  from ${fact.sourceAttemptId}` +
          (fact.supersedesFactId === null
            ? ""
            : `  supersedes ${fact.supersedesFactId}`),
      );
    }
  }

  lines.push("Findings:");

  if (data.findings.length === 0) {
    lines.push("  (none)");
  } else {
    for (const finding of data.findings) {
      lines.push(
        `  ${finding.id}  ${finding.severity}  ${finding.disposition}  ${finding.summary}`,
      );
    }
  }

  lines.push(`Breadcrumb: ${renderBreadcrumbLine(data.breadcrumb)}`);
  return lines.join("\n");
}

export function renderStatusDetailData(detail: StatusDetailData): string {
  const lines = [
    `Status: ${detail.status}`,
    `Task: ${detail.taskId} (revision ${detail.taskRevision})`,
  ];

  if (detail.waitingReason !== null) {
    lines.push(`Waiting: ${detail.waitingReason}`);
  }

  lines.push(`Next: ${detail.next ?? "(none)"}`);
  lines.push(
    `Obligations: ${detail.doneObligations}/${detail.totalObligations} required satisfied`,
  );
  lines.push("Nodes:");

  for (const node of detail.nodes) {
    lines.push(
      `  ${node.nodeId}  ${node.status}${node.attemptId === null ? "" : `  ${node.attemptId}`}`,
    );
  }

  lines.push(`Breadcrumb: ${renderBreadcrumbLine(detail.breadcrumb)}`);
  return lines.join("\n");
}

export function renderTaskNextData(data: TaskNextData): string {
  const lines = [renderCommandData(data), "", "Nodes:"];

  for (const node of data.nodes) {
    lines.push(
      `  ${node.nodeId}  ${node.status}${node.attemptId === null ? "" : `  ${node.attemptId}`}`,
    );
  }

  lines.push("Runnable work:");
  for (const item of data.runnableWorkItems) {
    lines.push(`  ${item.taskId}  ${item.command}  ${item.reason}`);
  }

  return lines.join("\n");
}

/** Review command render data: the reducer's review result plus the outcome
 * constant and the purpose/capability/independence disclosure echoed by the
 * command boundary. text and JSON consume the same object. */
export interface ReviewRenderData extends ReviewResultData {
  outcome?: "passed" | "changes_requested" | "replan_required";
  purpose?: ReviewPurpose;
  capability?: ReviewCapability;
  independenceStatus?: ReviewIndependenceStatus;
  finding?: string;
}

export function renderReviewData(data: ReviewRenderData): string {
  const lines = [renderCommandData(data)];
  lines.push(`Review attempt: ${data.reviewAttemptId}`);
  lines.push(`Reviewed attempt: ${data.reviewedAttemptId}`);

  if (data.outcome !== undefined) {
    lines.push(`Outcome: ${data.outcome}`);
  }

  if (data.purpose !== undefined) {
    lines.push(`Purpose: ${data.purpose}`);
  }

  if (data.capability !== undefined) {
    lines.push(`Capability: ${data.capability}`);
  }

  if (data.independenceStatus !== undefined) {
    lines.push(`Independence: ${data.independenceStatus}`);
  }

  if (data.findingId !== undefined) {
    lines.push(
      `Finding: ${data.findingId}${data.finding === undefined ? "" : `: ${data.finding}`}`,
    );
  }

  if (data.successorAttemptId !== undefined) {
    lines.push(`Successor attempt: ${data.successorAttemptId}`);
  }

  if (data.newRevision !== undefined) {
    lines.push(`New revision: ${data.newRevision}`);
  }

  if (data.l3Mode !== undefined) {
    lines.push(`L3 mode: ${data.l3Mode}`);
  }

  for (const child of data.materializedChildren ?? []) {
    lines.push(
      `Child: ${child.taskId}  L${child.level}  ${child.moduleKey}${child.reused ? "  reused" : ""}`,
    );
  }

  if (data.nodeBrief !== undefined) {
    lines.push("", renderNodeBrief(data.nodeBrief));
  }

  return lines.join("\n");
}

export function renderStatusData(data: StatusData): string {
  if (data.currentTask !== null) {
    return renderStatusDetailData(data.currentTask);
  }

  return renderTaskList(data.tasks);
}

export function renderTaskList(entries: StatusTaskEntry[]): string {
  if (entries.length === 0) {
    return "No tasks yet. Create one with: tc task new --title <t> --level 1 --reason <r>";
  }

  const lines = ["Tasks:"];

  for (const entry of entries) {
    lines.push(`  ${entry.taskId}  ${entry.status}  ${entry.next ?? "(none)"}`);
  }

  return lines.join("\n");
}

export function renderTaskListEntries(entries: TaskListEntry[]): string {
  if (entries.length === 0) {
    return "No tasks. Create one with: tc task new --title <t> --level 1 --reason <r>";
  }

  const lines = ["Tasks:"];

  for (const entry of entries) {
    lines.push(
      `  ${entry.taskId}  ${entry.status}  L${entry.level}  ${entry.title}` +
        (entry.parentTaskId === null ? "" : `  parent: ${entry.parentTaskId}`) +
        (entry.waitingReason === null
          ? ""
          : `  waiting: ${entry.waitingReason}`) +
        (entry.next === null ? "" : `  next: ${entry.next}`),
    );
  }

  return lines.join("\n");
}

export function renderBreadcrumbLine(breadcrumb: BreadcrumbV1): string {
  const anchor =
    breadcrumb.task === null
      ? "none"
      : `${breadcrumb.task.id} rev ${breadcrumb.task.taskRevision}`;

  return `[${breadcrumb.takeover}] ${anchor} -> ${breadcrumb.next.command}`;
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
