import type { BreadcrumbV1 } from "./breadcrumb.js";
import type {
  AcceptanceAnchorRow,
  AnchorCoverageRow,
  BlockerWaitingReason,
  ExecutionSourceRow,
  InheritedPlanningRow,
  NodeKind,
  TaskDependencyRow,
  ValidationAssignmentRow,
} from "../store/query.js";

export type ProjectStatus =
  "queued" | "active" | "waiting" | "done" | "cancelled";
export type NodeProjectionStatus =
  "satisfied" | "running" | "runnable" | "blocked";

export interface NodeProjection {
  nodeId: string;
  kind: NodeKind;
  status: NodeProjectionStatus;
  attemptId: string | null;
}

export interface RunnableWorkItem {
  taskId: string;
  parentTaskId: string | null;
  nodeId: string | null;
  command: string;
  reason: string;
}

export interface ChildProjection {
  moduleKey: string;
  taskId: string;
  title: string;
  level: 1 | 2;
  requirementStatus: "required" | "not_required";
  orderIndex: number;
  status: ProjectStatus;
  waitingReason: BlockerWaitingReason | null;
  taskRevision: number;
  doneObligations: number;
  totalObligations: number;
  next: string | null;
}

export interface Projection {
  status: ProjectStatus;
  waitingReason: BlockerWaitingReason | null;
  nodeStatuses: NodeProjection[];
  runnableNodes: string[];
  runningNode: string | null;
  runnableWorkItems: RunnableWorkItem[];
  children: ChildProjection[];
  anchors: AcceptanceAnchorRow[];
  coverage: AnchorCoverageRow[];
  dependencies: TaskDependencyRow[];
  validations: ValidationAssignmentRow[];
  executionSource: ExecutionSourceRow | null;
  inheritedPlanning: InheritedPlanningRow | null;
  doneObligations: number;
  totalObligations: number;
  next: string | null;
  breadcrumb: BreadcrumbV1;
}
