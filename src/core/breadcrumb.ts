// tc-breadcrumb/v1 constructor. The shape is locked by
// src/contracts/breadcrumb.schema.json; the projector decides the
// values, this module only assembles a schema-valid document.

import type { NodeKind } from "../store/query.js";
import type { BlockerWaitingReason } from "../store/query.js";
import type { ProjectStatus } from "./projector.js";

export const BREADCRUMB_SCHEMA_VERSION = "tc-breadcrumb/v1";

export interface BreadcrumbTaskAnchor {
  id: string;
  level: 1 | 2 | 3;
  status: ProjectStatus;
  taskRevision: number;
  lifecycleRevision: number;
  waitingReason: BlockerWaitingReason | null;
  node: string | null;
  nodeKind: NodeKind | null;
}

export interface BreadcrumbV1 {
  schemaVersion: "tc-breadcrumb/v1";
  takeover: "silent" | "ask" | "active";
  task: BreadcrumbTaskAnchor | null;
  blocked: string[];
  next: { command: string; reason?: string };
  detailCommand: string;
}

export interface BreadcrumbInput {
  task: BreadcrumbTaskAnchor;
  /** The unique next command, or null when the task is finished. */
  nextCommand: string | null;
  blocked?: string[];
}

export function buildBreadcrumb(input: BreadcrumbInput): BreadcrumbV1 {
  const detailCommand = `tc task show ${input.task.id} --json`;

  return {
    schemaVersion: BREADCRUMB_SCHEMA_VERSION,
    takeover: "active",
    task: input.task,
    blocked: input.blocked ?? [],
    next: { command: input.nextCommand ?? detailCommand },
    detailCommand,
  };
}
