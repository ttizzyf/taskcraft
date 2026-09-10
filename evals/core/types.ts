export type Verdict = "pass" | "fail" | "inconclusive";

export type CheckGrader = "code" | "model";

export type HostAdapter = "claude" | "pi-sdk";

export interface CheckResult {
  id: string;
  grader: CheckGrader;
  verdict: Verdict;
  reason: string;
  evidence: string[];
}

export interface CliExecution {
  status: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

export interface HostRunRequest {
  cwd: string;
  prompt: string;
  model?: string;
  timeoutMs: number;
  pollMs?: number;
  stopWhen?: () => Promise<boolean>;
  tools?: string;
  allowedTools?: string[];
  jsonSchema?: string;
}

export interface HostRun {
  phase: string;
  status: "success" | "error" | "timeout" | "invalid" | "interrupted";
  exitCode: number | null;
  signal: string | null;
  elapsedMs: number;
  callCount: number | null;
  resultText: string | null;
  diagnostics: string[];
  hostVersion?: string | null;
  model?: string | null;
  resultMetadata?: Record<string, unknown> | null;
  host?: HostAdapter | null;
  requestedModel?: string | null;
  requestedThinkingLevel?: string | null;
  observedProvider?: string | null;
  observedApi?: string | null;
  observedThinkingLevel?: string | null;
}

export interface JudgeRequest {
  cwd: string;
  prompt: string;
  model?: string;
  timeoutMs: number;
}

export interface ModelCriteria {
  id: string;
  question: string;
}

export interface TaskSnapshot {
  taskId: string;
  status: string;
  taskRevision: number;
  attempts: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
  /** Optional fields from newer `tc task show` payloads. */
  findings?: Array<Record<string, unknown>>;
  nodeBrief?: Record<string, unknown> | null;
}

export interface TaskReadResult {
  snapshot: TaskSnapshot | null;
  error: string | null;
}

export interface CheckpointEvidence {
  established: boolean;
  initialSourceFiles: Array<{ path: string; sha256: string; bytes: number }>;
  sourceFiles: Array<{ path: string; sha256: string; bytes: number }>;
  taskStatus: string | null;
  attemptIds: string[];
  capturedAt: string;
  reason: string;
}

export interface CaseSetup {
  taskId: string;
  workspace: string;
  requirement: string;
  modelCriteria: ModelCriteria[];
  metadata: Record<string, unknown>;
}

export interface CaseExecution {
  hostRuns: HostRun[];
  checkpoint?: CheckpointEvidence;
}

export interface EvalContext {
  repoRoot: string;
  cliPath: string;
  runTc(
    cwd: string,
    args: readonly string[],
    input?: string,
  ): Promise<CliExecution>;
  readTask(cwd: string, taskId: string): Promise<TaskReadResult>;
  hashSources(
    workspace: string,
  ): Promise<Array<{ path: string; sha256: string; bytes: number }>>;
  host: {
    run(request: HostRunRequest, phase: string): Promise<HostRun>;
  };
}

export interface EvalCase {
  id: string;
  title: string;
  description: string;
  requirements: string;
  modelCriteria: ModelCriteria[];
  prepare(context: EvalContext, workspace: string): Promise<CaseSetup>;
  execute(
    context: EvalContext,
    setup: CaseSetup,
    actorTimeoutMs: number,
    model: string | undefined,
  ): Promise<CaseExecution>;
  grade(
    context: EvalContext,
    setup: CaseSetup,
    execution: CaseExecution,
    task: TaskReadResult,
  ): Promise<CheckResult[]>;
}

export interface EvalOptions {
  caseId?: string;
  list: boolean;
  actorTimeoutMs: number;
  judgeTimeoutMs: number;
  model?: string;
  judgeModel?: string;
  host?: HostAdapter;
  outputPath?: string;
}

export interface ModelGrade {
  checks: CheckResult[];
  elapsedMs: number | null;
  callCount: number | null;
  diagnostics: string[];
  model: string | null;
  hostVersion: string | null;
  host?: HostAdapter | null;
  requestedModel?: string | null;
  requestedThinkingLevel?: string | null;
  observedProvider?: string | null;
  observedApi?: string | null;
  observedThinkingLevel?: string | null;
}

export interface EvalReport {
  schemaVersion: "tc-eval/v1";
  caseId: string;
  title: string;
  verdict: Verdict;
  summary: string;
  startedAt: string;
  finishedAt: string;
  workspace: string;
  requirements: string;
  setupError: string | null;
  executionError: string | null;
  gradingError: string | null;
  graderError: string | null;
  actor: Array<{
    phase: string;
    status: HostRun["status"];
    elapsedMs: number;
    callCount: number | null;
    diagnostics: string[];
    hostVersion: string | null;
    model: string | null;
    resultMetadata: Record<string, unknown> | null;
    host?: HostAdapter | null;
    requestedModel?: string | null;
    requestedThinkingLevel?: string | null;
    observedProvider?: string | null;
    observedApi?: string | null;
    observedThinkingLevel?: string | null;
  }>;
  checks: CheckResult[];
  model: {
    status: "not-run" | "pass" | "fail" | "inconclusive";
    elapsedMs: number | null;
    callCount: number | null;
    diagnostics: string[];
    host?: HostAdapter | null;
    requestedModel?: string | null;
    requestedThinkingLevel?: string | null;
    observedProvider?: string | null;
    observedApi?: string | null;
    observedThinkingLevel?: string | null;
  };
  checkpoint?: CheckpointEvidence;
  task: TaskSnapshot | null;
  taskReadError: string | null;
  environment: {
    node: string;
    host: string;
    model: string | null;
    judgeModel: string | null;
    hostAdapter?: HostAdapter | null;
    actorThinkingLevel?: string | null;
    judgeThinkingLevel?: string | null;
  };
  provenance?: EvalProvenance | undefined;
}

export type ActorSession = EvalReport["actor"][number];

export interface EvalProvenance {
  caseFingerprint: string;
  graderFingerprint: string;
  comparisonFingerprint: string;
  actorModel: string | null;
  judgeModel: string | null;
  hostVersion: string | null;
  actorTimeoutMs: number;
  judgeTimeoutMs: number;
  subjectRevision: string | null;
  hostAdapter?: HostAdapter | null;
  actorApi?: string | null;
  judgeApi?: string | null;
  actorThinkingLevel?: string | null;
  judgeThinkingLevel?: string | null;
}
