// Read-only JSON API handlers for the watch server. Every endpoint renders
// the projector / query model output directly; the watch layer adds no
// second derivation and never writes to the store.

import { project } from "../core/projector.js";
import type { Projection, ProjectStatus } from "../core/projector.js";
import type { TaskcraftDatabase } from "../store/database.js";
import {
  getAgentRuns,
  getAttempts,
  getEvidence,
  getLifecycle,
  getObligationResults,
  getOpenBlockers,
  getReviewFindings,
  getReviewLinks,
  getTask,
  getTaskFacts,
  listTasks,
} from "../store/query.js";
import type {
  AgentRunRow,
  AttemptRow,
  BlockerRow,
  BlockerWaitingReason,
  EvidenceRow,
  LifecycleGraph,
  NodeKind,
  ObligationResultRow,
  ReviewFindingRow,
  ReviewLinkRow,
  TaskFactRow,
} from "../store/query.js";
import { collectDiagnostics } from "./diagnostics.js";
import type { DiagnosticItem } from "./diagnostics.js";

// --- board ---------------------------------------------------------------

export interface TaskCard {
  id: string;
  title: string;
  level: number;
  status: ProjectStatus;
  waitingReason: BlockerWaitingReason | null;
  node: string | null;
  nodeKind: NodeKind | null;
  doneObligations: number;
  totalObligations: number;
  host: string | null;
  lastActivity: string;
  next: string | null;
}

export interface WatchBoard {
  groups: {
    active: TaskCard[];
    waiting: TaskCard[];
    queued: TaskCard[];
    done: TaskCard[];
    cancelled: TaskCard[];
  };
  generatedAt: string;
}

export function buildBoard(database: TaskcraftDatabase | null): WatchBoard {
  const groups: WatchBoard["groups"] = {
    active: [],
    waiting: [],
    queued: [],
    done: [],
    cancelled: [],
  };

  if (database !== null) {
    for (const task of listTasks(database)) {
      const projection = project(database, task.id);
      groups[projection.status].push(buildCard(database, task.id, projection));
    }
  }

  return { groups, generatedAt: new Date().toISOString() };
}

function buildCard(
  database: TaskcraftDatabase,
  taskId: string,
  projection: Projection,
): TaskCard {
  const snapshot = getTask(database, taskId)!;
  const attempts = getAttempts(database, taskId);
  const latest = attempts.at(-1) ?? null;
  const node = projection.runningNode ?? projection.runnableNodes[0] ?? null;
  const nodeKind =
    projection.nodeStatuses.find((state) => state.nodeId === node)?.kind ??
    null;
  const lastActivity =
    [snapshot.updatedAt, latest?.startedAt, latest?.finishedAt]
      .filter((value): value is string => value !== null && value !== undefined)
      .sort()
      .at(-1) ?? snapshot.updatedAt;

  return {
    id: taskId,
    title: snapshot.title,
    level: snapshot.level,
    status: projection.status,
    waitingReason: projection.waitingReason,
    node,
    nodeKind,
    doneObligations: projection.doneObligations,
    totalObligations: projection.totalObligations,
    host: latest?.host ?? null,
    lastActivity,
    next: projection.next,
  };
}

// --- task detail ----------------------------------------------------------

export interface WatchEventRow {
  eventId: string;
  taskId: string;
  taskSeq: number;
  lifecycleRevision: number;
  nodeId: string | null;
  attemptId: string | null;
  actorInstanceId: string;
  host: string | null;
  eventType: string;
  payload: unknown;
  postTaskRevision: number;
  occurredAt: string;
}

export interface WatchTaskDetail {
  task: {
    id: string;
    title: string;
    level: number;
    status: ProjectStatus;
    waitingReason: BlockerWaitingReason | null;
    next: string | null;
    taskRevision: number;
    lifecycleRevision: number;
    objective: string;
    scope: unknown;
    acceptance: unknown;
    nonGoals: unknown;
    classificationFacts: unknown;
    classificationReasons: unknown;
    parentTaskId: string | null;
    activatedAt: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    createdAt: string;
    updatedAt: string;
  };
  projection: {
    nodeStatuses: Projection["nodeStatuses"];
    runnableNodes: string[];
    runningNode: string | null;
    doneObligations: number;
    totalObligations: number;
    breadcrumb: Projection["breadcrumb"];
  };
  graph: LifecycleGraph;
  attempts: AttemptRow[];
  evidence: EvidenceRow[];
  obligationResults: ObligationResultRow[];
  findings: ReviewFindingRow[];
  taskFacts: Array<
    Omit<TaskFactRow, "taskId" | "valueJson"> & { value: unknown }
  >;
  reviewLinks: ReviewLinkRow[];
  blockers: BlockerRow[];
  events: WatchEventRow[];
  next: string | null;
}

/** Full detail for one task; null means the task is unknown (404). */
export function buildTaskDetail(
  database: TaskcraftDatabase | null,
  taskId: string,
): WatchTaskDetail | null {
  if (database === null) {
    return null;
  }

  const snapshot = getTask(database, taskId);

  if (snapshot === null) {
    return null;
  }

  const projection = project(database, taskId);

  return {
    task: {
      id: snapshot.id,
      title: snapshot.title,
      level: snapshot.level,
      status: projection.status,
      waitingReason: projection.waitingReason,
      next: projection.next,
      taskRevision: snapshot.revision,
      lifecycleRevision: snapshot.currentLifecycleRevision,
      objective: snapshot.objectiveMd,
      scope: parseJson(snapshot.scopeJson),
      acceptance: parseJson(snapshot.acceptanceJson),
      nonGoals: parseJson(snapshot.nonGoalsJson),
      classificationFacts: parseJson(snapshot.classificationFactsJson),
      classificationReasons: parseJson(snapshot.classificationReasonsJson),
      parentTaskId: snapshot.parentTaskId,
      activatedAt: snapshot.activatedAt,
      cancelledAt: snapshot.cancelledAt,
      cancelReason: snapshot.cancelReason,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    },
    projection: {
      nodeStatuses: projection.nodeStatuses,
      runnableNodes: projection.runnableNodes,
      runningNode: projection.runningNode,
      doneObligations: projection.doneObligations,
      totalObligations: projection.totalObligations,
      breadcrumb: projection.breadcrumb,
    },
    graph: getLifecycle(database, taskId, snapshot.currentLifecycleRevision),
    attempts: getAttempts(database, taskId),
    evidence: getEvidence(database, taskId),
    obligationResults: getObligationResults(database, taskId),
    findings: getReviewFindings(database, taskId),
    taskFacts: getTaskFacts(database, taskId).map((row) => ({
      id: row.id,
      category: row.category,
      subject: row.subject,
      value: parseJson(row.valueJson),
      sourceAttemptId: row.sourceAttemptId,
      evidenceId: row.evidenceId,
      supersedesFactId: row.supersedesFactId,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    })),
    reviewLinks: getReviewLinks(database, taskId),
    blockers: getOpenBlockers(database, taskId),
    events: getEvents(database, taskId),
    next: projection.next,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The event timeline is read here (read-only) so the store query model
 * keeps its line budget; the data is still the same SQLite store. */
function getEvents(
  database: TaskcraftDatabase,
  taskId: string,
): WatchEventRow[] {
  const rows = database
    .prepare(
      `SELECT event_id AS eventId, task_id AS taskId, task_seq AS taskSeq,
              lifecycle_revision AS lifecycleRevision, node_id AS nodeId,
              attempt_id AS attemptId, actor_instance_id AS actorInstanceId,
              host, event_type AS eventType, payload_json AS payloadJson,
              post_task_revision AS postTaskRevision, occurred_at AS occurredAt
       FROM events
       WHERE task_id = ?
       ORDER BY task_seq`,
    )
    .all(taskId) as Array<
    Omit<WatchEventRow, "payload"> & { payloadJson: string }
  >;

  return rows.map(({ payloadJson, ...row }) => ({
    ...row,
    payload: parseJson(payloadJson),
  }));
}

// --- runtime ---------------------------------------------------------------

export interface WatchRuntimeByTask {
  taskId: string;
  total: number;
  hosts: string[];
  lastSeenAt: string | null;
}

export interface WatchRuntime {
  runs: AgentRunRow[];
  byTask: WatchRuntimeByTask[];
  generatedAt: string;
}

export function buildRuntime(database: TaskcraftDatabase | null): WatchRuntime {
  const runs = database === null ? [] : getAgentRuns(database);
  const grouped = new Map<
    string,
    { total: number; hosts: Set<string>; lastSeenAt: string | null }
  >();

  for (const run of runs) {
    const entry = grouped.get(run.taskId) ?? {
      total: 0,
      hosts: new Set<string>(),
      lastSeenAt: null,
    };
    entry.total += 1;
    entry.hosts.add(run.host);

    if (
      run.lastSeenAt !== null &&
      (entry.lastSeenAt === null || run.lastSeenAt > entry.lastSeenAt)
    ) {
      entry.lastSeenAt = run.lastSeenAt;
    }

    grouped.set(run.taskId, entry);
  }

  const byTask = [...grouped.entries()].map(([taskId, entry]) => ({
    taskId,
    total: entry.total,
    hosts: [...entry.hosts].sort(),
    lastSeenAt: entry.lastSeenAt,
  }));

  return { runs, byTask, generatedAt: new Date().toISOString() };
}

// --- diagnostics ------------------------------------------------------------

export interface WatchDiagnostics {
  items: DiagnosticItem[];
  generatedAt: string;
}

export function buildDiagnostics(projectDir: string): WatchDiagnostics {
  return {
    items: collectDiagnostics(projectDir),
    generatedAt: new Date().toISOString(),
  };
}
