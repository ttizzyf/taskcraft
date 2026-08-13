// Text renderer. Every render function consumes plain data produced by the
// projector / query model (or the reducer's command data); there is no second
// derivation of task state here, so text and JSON always stay in sync.

import type { BreadcrumbV1 } from "../core/breadcrumb.js";
import type {
  CommandData,
  NodeBrief,
  ReviewResultData,
} from "../core/reducer.js";
import type { NodeProjection, ProjectStatus } from "../core/projector.js";
import type {
  AttemptOutcome,
  AttemptStatus,
  BlockerWaitingReason,
  ReviewCapability,
  ReviewIndependenceStatus,
  ReviewPurpose,
} from "../store/query.js";

/** Data shapes shared by the command actions; the renderers only read these. */
export interface TaskNextData extends CommandData {
  nodes: NodeProjection[];
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
    `Node: ${brief.nodeId} (${brief.nodeKind})`,
    `Attempt: ${brief.attemptId}`,
    `Objective: ${brief.objective}`,
    `Procedure: ${brief.procedureRef}`,
    "Obligations:",
    ...brief.obligations.map(
      (obligation) =>
        `  - ${obligation.id} (${obligation.duty}): ${obligation.title}`,
    ),
    "Result schema:",
    indent(JSON.stringify(schema, null, 2), "  "),
    `Complete command: ${brief.nextCommand}`,
  ];

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
    `Objective: ${data.objective}`,
    `Scope: ${JSON.stringify(data.scope)}`,
    `Acceptance: ${JSON.stringify(data.acceptance)}`,
    `Created: ${data.createdAt}`,
  ];

  if (data.waitingReason !== null) {
    lines.push(`Waiting: ${data.waitingReason}`);
  }

  lines.push(`Next: ${data.next ?? "(none)"}`);
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
