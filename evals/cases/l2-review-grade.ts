import type {
  CaseExecution,
  CaseSetup,
  CheckResult,
  TaskReadResult,
  TaskSnapshot,
} from "../core/types.ts";
import { gradeCsvArtifact } from "./csv.ts";
import type { L2ReviewTrace } from "./l2-review-flow.ts";

export async function gradeL2Review(
  setup: CaseSetup,
  execution: CaseExecution,
  task: TaskReadResult,
): Promise<CheckResult[]> {
  const checks = await gradeCsvArtifact(setup.workspace);
  const trace = traceOf(execution);
  const snapshot = task.snapshot;
  const taskDoneVerdict =
    snapshot === null
      ? "inconclusive"
      : snapshot.status === "done"
        ? "pass"
        : "fail";
  checks.push(
    check(
      "l2-host-sessions",
      trace !== null && requiredHostPhases(execution) ? "pass" : "fail",
      "independent reviewer, repair, and re-review sessions must all complete successfully",
      execution.hostRuns
        .map((run) => `${run.phase}=${run.status}`)
        .join(", ") || "no host sessions",
    ),
    check(
      "l2-task-done",
      taskDoneVerdict,
      snapshot === null
        ? "the final Taskcraft snapshot was unavailable; completion cannot be determined"
        : snapshot.status === "done"
          ? "Taskcraft projected the reviewed task as done"
          : `Taskcraft projected ${snapshot.status}, not done`,
      snapshot === null
        ? (task.error ?? "task show failed")
        : `task=${snapshot.taskId}`,
    ),
  );
  if (trace === null || snapshot === null) {
    checks.push(
      check(
        "l2-review-graph",
        "inconclusive",
        "the execution trace or final Taskcraft snapshot is unavailable",
        task.error ?? "review trace was not returned",
      ),
    );
    return checks;
  }

  const first = trace.firstReview;
  const second = trace.secondReview;
  const successor = trace.successorExecuteAttemptId;
  checks.push(
    check(
      "l2-frame",
      hasAttempt(snapshot, "frame-1", "success") ? "pass" : "fail",
      "the required Frame attempt must finish successfully",
      attemptsFor(snapshot, "frame-1"),
    ),
    check(
      "l2-seeded-execute",
      hasAttemptId(
        snapshot,
        trace.initialExecuteAttemptId,
        "execute-1",
        "success",
      )
        ? "pass"
        : "fail",
      "the controller-seeded Execute remains as historical success",
      trace.initialExecuteAttemptId,
    ),
    check(
      "l2-review-association",
      reviewAssociation(trace) ? "pass" : "fail",
      "each review start must expose its exact reviewed attempt with a truthful disclosure",
      reviewAssociationEvidence(trace),
    ),
    check(
      "l2-review-context",
      reviewContextAssociation(trace) ? "pass" : "fail",
      "task show after review start must expose the same reviewed attempt in nodeBrief.reviewContext",
      reviewContextEvidence(trace),
    ),
    check(
      "l2-changes-requested",
      hasAttemptId(
        snapshot,
        first.reviewAttemptId,
        "review-1",
        "changes_requested",
      )
        ? "pass"
        : "fail",
      "the first real reviewer must submit changes_requested",
      first.reviewAttemptId,
    ),
    check(
      "l2-successor-execute",
      successor !== null &&
        hasAttemptId(snapshot, successor, "execute-1", "success") &&
        laterAttempt(snapshot, trace.initialExecuteAttemptId, successor)
        ? "pass"
        : "fail",
      "changes_requested must create and preserve a successful successor Execute",
      successor ?? "successor execute was not observed",
    ),
    check(
      "l2-rereview-passed",
      second !== null &&
        successor !== null &&
        hasAttemptId(snapshot, second.reviewAttemptId, "review-1", "passed") &&
        second.reviewedAttemptId === successor
        ? "pass"
        : "fail",
      "a fresh reviewer must pass the repaired successor Execute",
      second?.reviewAttemptId ?? "second review was not observed",
    ),
    check(
      "l2-review-evidence",
      second !== null && reviewEvidence(snapshot, second.reviewAttemptId)
        ? "pass"
        : "fail",
      "the passed re-review must leave evidence bound to its own Review attempt",
      second === null
        ? "second review was not observed"
        : evidenceFor(snapshot, second.reviewAttemptId),
    ),
    check(
      "l2-record",
      hasAttempt(snapshot, "record-1", "success") &&
        trace.finalTask?.snapshot?.status === "done"
        ? "pass"
        : "fail",
      "Record must be observed through tc after the passed review and finish successfully",
      attemptsFor(snapshot, "record-1"),
    ),
    check(
      "l2-finding-history",
      findingMatches(snapshot, first.reviewAttemptId) ? "pass" : "fail",
      "the blocking finding from the first review must remain queryable",
      findingEvidence(snapshot),
    ),
    check(
      "tc-fixture-provenance",
      provenanceFactMatches(snapshot) ? "pass" : "fail",
      "the controller-seeded fixture must retain a generic provenance fact",
      provenanceEvidence(snapshot),
    ),
    check(
      "l2-attempt-evidence",
      successor !== null &&
        second !== null &&
        snapshot.evidence.some(
          (evidence) =>
            evidence.nodeAttemptId === successor &&
            evidence.type === "validation",
        ) &&
        reviewEvidence(snapshot, second.reviewAttemptId)
        ? "pass"
        : "fail",
      "the final Execute and Review attempts must own durable validation evidence",
      `${evidenceFor(snapshot, successor ?? "")} ; ${evidenceFor(snapshot, second?.reviewAttemptId ?? "")}`,
    ),
  );
  return checks;
}

function traceOf(execution: CaseExecution): L2ReviewTrace | null {
  const candidate = (execution as { reviewTrace?: unknown }).reviewTrace;
  if (
    !isRecord(candidate) ||
    !isRecord(candidate.firstReview) ||
    typeof candidate.initialExecuteAttemptId !== "string" ||
    !isRecord(candidate.firstReview.data) ||
    !isRecord(candidate.firstReview.task) ||
    typeof candidate.firstReview.reviewAttemptId !== "string" ||
    typeof candidate.firstReview.reviewedAttemptId !== "string"
  ) {
    return null;
  }
  const second = candidate.secondReview;
  if (
    second !== null &&
    second !== undefined &&
    (!isRecord(second) ||
      !isRecord(second.data) ||
      !isRecord(second.task) ||
      typeof second.reviewAttemptId !== "string" ||
      typeof second.reviewedAttemptId !== "string")
  ) {
    return null;
  }
  return candidate as unknown as L2ReviewTrace;
}

function requiredHostPhases(execution: CaseExecution): boolean {
  return ["l2-reviewer-initial", "l2-repair", "l2-reviewer-final"].every(
    (phase) =>
      execution.hostRuns.filter((run) => run.phase === phase).length === 1 &&
      execution.hostRuns.find((run) => run.phase === phase)?.status ===
        "success",
  );
}

function reviewAssociation(trace: L2ReviewTrace): boolean {
  const first = trace.firstReview;
  const second = trace.secondReview;
  return (
    truthfulDisclosure(first.data) &&
    first.reviewedAttemptId === trace.initialExecuteAttemptId &&
    second !== null &&
    truthfulDisclosure(second.data) &&
    second.reviewedAttemptId === trace.successorExecuteAttemptId &&
    first.reviewAttemptId !== first.reviewedAttemptId
  );
}

function reviewContextAssociation(trace: L2ReviewTrace): boolean {
  return (
    nodeBriefReviews(trace.firstReview.task, trace.initialExecuteAttemptId) &&
    trace.secondReview !== null &&
    trace.successorExecuteAttemptId !== null &&
    nodeBriefReviews(trace.secondReview.task, trace.successorExecuteAttemptId)
  );
}

function nodeBriefReviews(
  task: TaskReadResult,
  reviewedAttemptId: string,
): boolean {
  const context = task.snapshot?.nodeBrief?.reviewContext;
  return (
    isRecord(context) &&
    context.reviewedAttemptId === reviewedAttemptId &&
    context.outcome === "success"
  );
}

function truthfulDisclosure(data: Record<string, unknown>): boolean {
  return (
    data.purpose === "delivery" &&
    data.capability === "context-only" &&
    data.independenceStatus === "unverified"
  );
}

function findingMatches(
  snapshot: TaskSnapshot,
  reviewAttemptId: string,
): boolean {
  return (snapshot.findings ?? []).some(
    (finding) =>
      finding.reviewAttemptId === reviewAttemptId &&
      finding.severity === "blocking" &&
      typeof finding.summary === "string" &&
      finding.summary.trim() !== "",
  );
}

function provenanceFactMatches(snapshot: TaskSnapshot): boolean {
  return snapshot.facts.some((fact) => {
    const value = isRecord(fact.value) ? fact.value : null;
    return (
      fact.subject === "fixture" &&
      value?.source === "eval-controller" &&
      value.kind === "known-defect-sample"
    );
  });
}

function reviewEvidence(
  snapshot: TaskSnapshot,
  reviewAttemptId: string,
): boolean {
  return snapshot.evidence.some(
    (evidence) =>
      evidence.nodeAttemptId === reviewAttemptId &&
      typeof evidence.reference === "string" &&
      evidence.reference.trim() !== "",
  );
}

function laterAttempt(
  snapshot: TaskSnapshot,
  initialId: string,
  successorId: string,
): boolean {
  const initial = snapshot.attempts.find((attempt) => attempt.id === initialId);
  const successor = snapshot.attempts.find(
    (attempt) => attempt.id === successorId,
  );
  return (
    typeof initial?.attemptNumber === "number" &&
    typeof successor?.attemptNumber === "number" &&
    successor.attemptNumber > initial.attemptNumber &&
    initial.lifecycleRevision === successor.lifecycleRevision
  );
}

function hasAttempt(
  snapshot: TaskSnapshot,
  nodeId: string,
  outcome: string,
): boolean {
  return snapshot.attempts.some(
    (attempt) =>
      attempt.nodeId === nodeId &&
      attempt.status === "finished" &&
      attempt.outcome === outcome,
  );
}

function hasAttemptId(
  snapshot: TaskSnapshot,
  id: string,
  nodeId: string,
  outcome: string,
): boolean {
  return snapshot.attempts.some(
    (attempt) =>
      attempt.id === id &&
      attempt.nodeId === nodeId &&
      attempt.status === "finished" &&
      attempt.outcome === outcome,
  );
}

function attemptsFor(snapshot: TaskSnapshot, nodeId: string): string {
  return (
    snapshot.attempts
      .filter((attempt) => attempt.nodeId === nodeId)
      .map(
        (attempt) =>
          `${String(attempt.id)}:${String(attempt.status)}/${String(attempt.outcome)}`,
      )
      .join(", ") || `no ${nodeId} attempt`
  );
}

function evidenceFor(snapshot: TaskSnapshot, attemptId: string): string {
  return (
    snapshot.evidence
      .filter((evidence) => evidence.nodeAttemptId === attemptId)
      .map((evidence) => String(evidence.id))
      .join(", ") || `no evidence for ${attemptId || "attempt"}`
  );
}

function reviewAssociationEvidence(trace: L2ReviewTrace): string {
  const first = trace.firstReview;
  const second = trace.secondReview;
  return [
    `${first.reviewAttemptId}->${first.reviewedAttemptId} (${String(first.data.capability)}/${String(first.data.independenceStatus)})`,
    second === null
      ? "second review absent"
      : `${second.reviewAttemptId}->${second.reviewedAttemptId} (${String(second.data.capability)}/${String(second.data.independenceStatus)})`,
  ].join("; ");
}

function reviewContextEvidence(trace: L2ReviewTrace): string {
  return [trace.firstReview.task, trace.secondReview?.task]
    .map((result) => {
      const context = result?.snapshot?.nodeBrief?.reviewContext;
      return isRecord(context)
        ? String(context.reviewedAttemptId)
        : "missing reviewContext";
    })
    .join(", ");
}

function findingEvidence(snapshot: TaskSnapshot): string {
  return (
    (snapshot.findings ?? [])
      .map(
        (finding) =>
          `${String(finding.id)}:${String(finding.disposition)}/${String(finding.summary)}`,
      )
      .join(", ") || "no findings"
  );
}

function provenanceEvidence(snapshot: TaskSnapshot): string {
  return (
    snapshot.facts
      .filter((fact) => fact.subject === "fixture")
      .map((fact) => String(fact.id))
      .join(", ") || "no fixture fact"
  );
}

function check(
  id: string,
  verdict: CheckResult["verdict"],
  reason: string,
  evidence: string,
): CheckResult {
  return { id, grader: "code", verdict, reason, evidence: [evidence] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
