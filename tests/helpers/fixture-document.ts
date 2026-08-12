// tc-fixture/v1 document shape: the fact snapshot format accepted by
// load-fixture. Kept in its own file so the importer stays under the 400
// effective-line limit.

export interface FixtureTask {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  objectiveMd: string;
  activatedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  revision: number;
  currentLifecycleRevision?: number;
  /** Every lifecycle revision that exists for the task (default: just the
   * current one). Older revisions keep their definitions so historical
   * attempts and events stay referentially valid. */
  revisions?: number[];
}

export interface FixtureDocument {
  tasks: FixtureTask[];
  lifecycles: Array<{
    taskId: string;
    /** Lifecycle revision of this graph (default: the task's current one). */
    revision?: number;
    nodes: Array<{
      id: string;
      kind: string;
      title: string;
      objective: string;
      procedureRef: string;
      outputSchema?: unknown;
    }>;
    edges: Array<{ from: string; to: string; condition?: unknown }>;
    obligations: Array<{
      nodeId: string;
      id: string;
      duty: string;
      title: string;
      evaluator?: unknown;
    }>;
  }>;
  attempts: Array<{
    id: string;
    taskId: string;
    /** Lifecycle revision of this attempt (default: the task's current one). */
    lifecycleRevision?: number;
    nodeId: string;
    attemptNumber?: number;
    status: string;
    outcome: string | null;
    resultJson?: unknown;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
  reviewLinks: Array<{
    taskId: string;
    reviewAttemptId: string;
    reviewedAttemptId: string;
    purpose: string;
    capability: string;
    independenceStatus: string;
    reviewerPrincipalId?: string | null;
    observedHostSessionId?: string | null;
  }>;
  reviewFindings: Array<{
    id: string;
    taskId: string;
    reviewAttemptId: string;
    severity: string;
    disposition?: string;
    summary: string;
    evidenceRefs?: unknown;
    resolvedByAttemptId?: string | null;
    resolvedAt?: string | null;
  }>;
  evidence: Array<{
    id: string;
    taskId: string;
    nodeAttemptId: string;
    type: string;
    reference: string;
    summary: string;
    digest?: string | null;
  }>;
  /** Appended task facts; supersedes chains are ordered (a fact may only
   * supersede an earlier fact of the array). */
  taskFacts: Array<{
    id: string;
    taskId: string;
    category: string;
    subject: string;
    value: unknown;
    sourceAttemptId: string;
    evidenceId?: string | null;
    supersedesFactId?: string | null;
  }>;
  obligationResults: Array<{
    taskId: string;
    /** Lifecycle revision of this result (default: the task's current one).
     * Historical results reference their own revision's evidence. */
    lifecycleRevision?: number;
    nodeId: string;
    obligationId: string;
    status: string;
    satisfiedByEvidenceId: string | null;
  }>;
  blockers: Array<{
    id: string;
    taskId: string;
    nodeId: string | null;
    kind: string;
    waitingReason: string;
    status: string;
    reason: string;
    remediationCommand: string | null;
  }>;
  agentRuns: Array<{
    id: string;
    taskId: string;
    nodeAttemptId: string;
    observationStatus: string;
    finishReason?: string | null;
  }>;
  events: Array<{
    taskId: string;
    eventType: string;
    nodeId: string | null;
    attemptId: string | null;
    /** Lifecycle revision of the event (default: the task's current one).
     * Historical events reference the revision they happened in. */
    lifecycleRevision?: number;
    postTaskRevision?: number;
  }>;
}
