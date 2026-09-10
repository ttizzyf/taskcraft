import type {
  CheckpointEvidence,
  HostRun,
  TaskReadResult,
} from "../../core/types.ts";
import type { GraderArtifact } from "../../graders/model.ts";

/** Evidence-only prompt samples. They carry no expected verdict and are not a
 * calibration set or records of a real model evaluation. */
export interface ModelPromptSample {
  requirements: string;
  actorRuns: HostRun[];
  actorResult: string | null;
  artifacts: GraderArtifact[];
  checkpoint?: CheckpointEvidence;
  task: TaskReadResult;
}

const COMPLETE_ATTEMPT = "att-complete-execute";
const DEFECT_ATTEMPT = "att-defect-execute";

export const MODEL_PROMPT_SAMPLES: Record<string, ModelPromptSample> = {
  complete: {
    requirements:
      "Implement the quoted CSV summary and close the Taskcraft execute attempt with validation evidence.",
    actorRuns: [
      {
        phase: "delivery-actor",
        status: "success",
        exitCode: 0,
        signal: null,
        elapsedMs: 120,
        callCount: 3,
        resultText: "Implemented the parser and recorded validation.",
        diagnostics: [],
        resultMetadata: { observed: { stopReason: "stop" } },
      },
    ],
    actorResult: "Implemented the parser and recorded validation.",
    artifacts: [
      {
        path: "README.md",
        content:
          "Read quoted name,amount CSV; aggregate repeated names; reject malformed input.",
      },
      {
        path: "src/csv-summary.mjs",
        content:
          "parseCsv handles quoted commas and escaped quotes; main emits rows and totals.",
      },
      {
        path: "facts.json",
        content:
          '{"subject":"validation","checks":["quoted CSV","invalid amount"]}',
      },
      {
        path: "test-output.txt",
        content:
          "test output says pass; this actor-written text is not an independent score.",
      },
    ],
    task: {
      snapshot: {
        taskId: "T-complete",
        status: "done",
        taskRevision: 4,
        attempts: [
          {
            id: COMPLETE_ATTEMPT,
            nodeId: "execute-1",
            status: "finished",
            outcome: "success",
            resultJson: '{"summary":"validated implementation"}',
          },
        ],
        evidence: [
          {
            id: "ev-complete-validation",
            type: "validation",
            reference: "node contract assertions",
            summary: "Quoted and invalid-input cases were checked.",
            nodeAttemptId: COMPLETE_ATTEMPT,
          },
        ],
        facts: [
          {
            id: "fact-complete-validation",
            category: "probe",
            subject: "validation",
            value: { checks: ["quoted CSV", "invalid amount"] },
            sourceAttemptId: COMPLETE_ATTEMPT,
          },
        ],
      },
      error: null,
    },
  },
  defect: {
    requirements:
      "Implement the quoted CSV summary and reject malformed rows with a useful error.",
    actorRuns: [
      {
        phase: "review-actor",
        status: "success",
        exitCode: 0,
        signal: null,
        elapsedMs: 80,
        callCount: 2,
        resultText: "The implementation looks complete.",
        diagnostics: [],
      },
    ],
    actorResult: "The implementation looks complete.",
    artifacts: [
      {
        path: "README.md",
        content: "The name field may contain commas in RFC 4180 quoted cells.",
      },
      {
        path: "src/csv-summary.mjs",
        content:
          "const fields = line.split(','); // quoted commas are not parsed",
      },
    ],
    task: {
      snapshot: {
        taskId: "T-defect",
        status: "active",
        taskRevision: 2,
        attempts: [
          {
            id: DEFECT_ATTEMPT,
            nodeId: "execute-1",
            status: "running",
            outcome: null,
          },
        ],
        evidence: [],
        facts: [
          {
            id: "fact-defect-review",
            category: "probe",
            subject: "review",
            value: { finding: "quoted commas remain unhandled" },
            sourceAttemptId: DEFECT_ATTEMPT,
          },
        ],
      },
      error: null,
    },
  },
  insufficient: {
    requirements:
      "Finish the CSV implementation and prove the result with the required Taskcraft evidence.",
    actorRuns: [
      {
        phase: "recovery-first-session",
        status: "interrupted",
        exitCode: null,
        signal: "SIGTERM",
        elapsedMs: 250,
        callCount: null,
        resultText: null,
        diagnostics: ["controller interrupted after checkpoint probe"],
      },
    ],
    actorResult: null,
    artifacts: [
      {
        path: "src/csv-summary.mjs",
        content: "// partial draft; no observable completion output",
      },
    ],
    checkpoint: {
      established: false,
      initialSourceFiles: [],
      sourceFiles: [
        { path: "src/csv-summary.mjs", sha256: "draft", bytes: 48 },
      ],
      taskStatus: "active",
      attemptIds: ["att-open-but-unverified"],
      capturedAt: "2026-09-10T00:00:00.000Z",
      reason: "completion session was not observed",
    },
    task: {
      snapshot: null,
      error: "tc task show timed out",
    },
  },
};
