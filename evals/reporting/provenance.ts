import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  CSV_EXPECTED,
  CSV_INVALID_INPUT,
  CSV_MALFORMED_INPUT,
  CSV_REQUIREMENTS,
  CSV_VALID_INPUT,
} from "../cases/csv.ts";
import type {
  EvalCase,
  EvalProvenance,
  EvalReport,
  HostAdapter,
} from "../core/types.ts";

function sha256Short(data: string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

function sourceFingerprint(paths: string[]): string {
  return sha256Short(
    JSON.stringify(
      paths.map((path) => [
        path,
        readFileSync(new URL(path, import.meta.url), "utf8"),
      ]),
    ),
  );
}

function caseSourcePaths(caseId: string): string[] {
  const paths = [
    `../cases/${caseId}.ts`,
    "../cases/csv.ts",
    "../cases/utils.ts",
    "../hosts/claude.ts",
    "../hosts/pi.ts",
    "../hosts/pi-worker.ts",
    "../core/workspace.ts",
  ];
  if (caseId === "l2-review") {
    paths.push(
      "../cases/l2-review-flow.ts",
      "../cases/l2-review-grade.ts",
      "../cases/l2-review-evidence.ts",
      "../core/tc.ts",
      "../core/types.ts",
    );
  }
  return paths;
}

export function computeCaseFingerprint(caseDefinition: EvalCase): string {
  const payload = {
    implementation: sourceFingerprint(caseSourcePaths(caseDefinition.id)),
    id: caseDefinition.id,
    title: caseDefinition.title,
    description: caseDefinition.description,
    requirements: caseDefinition.requirements,
    csvRequirements: CSV_REQUIREMENTS.trim(),
  };
  return sha256Short(JSON.stringify(payload));
}

export function computeGraderFingerprint(caseDefinition: EvalCase): string {
  const implementationPaths = [
    `../cases/${caseDefinition.id}.ts`,
    "../cases/csv.ts",
    "../cases/utils.ts",
    "../graders/model.ts",
    "../hosts/pi.ts",
    "../hosts/pi-worker.ts",
    "../core/runner.ts",
    "../graders/artifacts.ts",
    "../core/tc.ts",
  ];
  if (caseDefinition.id === "l2-review") {
    implementationPaths.push(
      "../cases/l2-review-flow.ts",
      "../cases/l2-review-grade.ts",
      "../cases/l2-review-evidence.ts",
      "../core/types.ts",
    );
  }
  const payload = {
    implementation: sourceFingerprint(implementationPaths),
    caseId: caseDefinition.id,
    codeOracle: {
      checks: [
        "artifact-exists",
        "valid-csv",
        "invalid-csv",
        "malformed-csv",
        "task-contract",
      ],
      csvInputs: {
        valid: CSV_VALID_INPUT,
        expected: CSV_EXPECTED,
        invalid: CSV_INVALID_INPUT,
        malformed: CSV_MALFORMED_INPUT,
      },
    },
    modelRubric: caseDefinition.modelCriteria.map((c) => ({
      id: c.id,
      question: c.question,
    })),
  };
  return sha256Short(JSON.stringify(payload));
}

export function getSubjectGitRevision(repoRoot?: string): string | null {
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot ?? process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return revision.length > 0 ? revision : null;
  } catch {
    return null;
  }
}

export function computeComparisonFingerprint(params: {
  caseFingerprint: string;
  graderFingerprint: string;
  actorModel: string | null;
  judgeModel: string | null;
  actorTimeoutMs: number;
  judgeTimeoutMs: number;
  hostVersion?: string | null;
  hostAdapter?: HostAdapter | null;
  actorApi?: string | null;
  judgeApi?: string | null;
  actorThinkingLevel?: string | null;
  judgeThinkingLevel?: string | null;
}): string {
  const payload = {
    caseFingerprint: params.caseFingerprint,
    graderFingerprint: params.graderFingerprint,
    actorModel: params.actorModel,
    judgeModel: params.judgeModel,
    actorTimeoutMs: params.actorTimeoutMs,
    judgeTimeoutMs: params.judgeTimeoutMs,
    hostVersion: params.hostVersion ?? null,
    hostAdapter: params.hostAdapter ?? null,
    actorApi: params.actorApi ?? null,
    judgeApi: params.judgeApi ?? null,
    actorThinkingLevel: params.actorThinkingLevel ?? null,
    judgeThinkingLevel: params.judgeThinkingLevel ?? null,
  };
  return sha256Short(JSON.stringify(payload));
}

export interface BuildProvenanceOptions {
  caseDefinition: EvalCase;
  actorModel: string | null;
  judgeModel: string | null;
  hostVersion: string | null;
  actorTimeoutMs: number;
  judgeTimeoutMs: number;
  hostAdapter?: HostAdapter | null;
  actorApi?: string | null;
  judgeApi?: string | null;
  actorThinkingLevel?: string | null;
  judgeThinkingLevel?: string | null;
  repoRoot?: string;
  subjectRevision?: string | null;
}

export function buildProvenance(
  options: BuildProvenanceOptions,
): EvalProvenance {
  const caseFingerprint = computeCaseFingerprint(options.caseDefinition);
  const graderFingerprint = computeGraderFingerprint(options.caseDefinition);
  const comparisonFingerprint = computeComparisonFingerprint({
    caseFingerprint,
    graderFingerprint,
    actorModel: options.actorModel,
    judgeModel: options.judgeModel,
    actorTimeoutMs: options.actorTimeoutMs,
    judgeTimeoutMs: options.judgeTimeoutMs,
    hostVersion: options.hostVersion,
    ...(options.hostAdapter === undefined
      ? {}
      : { hostAdapter: options.hostAdapter }),
    ...(options.actorApi === undefined ? {} : { actorApi: options.actorApi }),
    ...(options.judgeApi === undefined ? {} : { judgeApi: options.judgeApi }),
    ...(options.actorThinkingLevel === undefined
      ? {}
      : { actorThinkingLevel: options.actorThinkingLevel }),
    ...(options.judgeThinkingLevel === undefined
      ? {}
      : { judgeThinkingLevel: options.judgeThinkingLevel }),
  });

  const subjectRevision =
    options.subjectRevision !== undefined
      ? options.subjectRevision
      : getSubjectGitRevision(options.repoRoot);

  return {
    caseFingerprint,
    graderFingerprint,
    comparisonFingerprint,
    actorModel: options.actorModel,
    judgeModel: options.judgeModel,
    hostVersion: options.hostVersion,
    actorTimeoutMs: options.actorTimeoutMs,
    judgeTimeoutMs: options.judgeTimeoutMs,
    subjectRevision,
    hostAdapter: options.hostAdapter ?? null,
    actorApi: options.actorApi ?? null,
    judgeApi: options.judgeApi ?? null,
    actorThinkingLevel: options.actorThinkingLevel ?? null,
    judgeThinkingLevel: options.judgeThinkingLevel ?? null,
  };
}

export type ComparisonCompatibility =
  | { comparable: true; reason: "conditions_match" }
  | { comparable: false; reason: "missing_metadata" | "condition_mismatch" };

function hasComparisonMetadata(
  value: EvalProvenance | undefined,
): value is EvalProvenance {
  if (value == null) return false;
  return (
    [
      value.caseFingerprint,
      value.graderFingerprint,
      value.comparisonFingerprint,
      value.actorModel,
      value.judgeModel,
    ].every((field) => typeof field === "string" && field.trim().length > 0) &&
    Number.isSafeInteger(value.actorTimeoutMs) &&
    value.actorTimeoutMs > 0 &&
    Number.isSafeInteger(value.judgeTimeoutMs) &&
    value.judgeTimeoutMs > 0
  );
}

/** Checks whether two reports were run under comparable conditions.
 *
 * Rules:
 * - Same caseId.
 * - Both must have known, non-null actorModel and judgeModel. Two nulls are NEVER treated as matching.
 * - Both must have valid provenance with identical comparisonFingerprint.
 * - If either lacks provenance or has null/unknown models, returns missing_metadata.
 * - If comparisonFingerprints differ, returns condition_mismatch.
 */
export function checkComparisonCompatibility(
  current: EvalReport,
  previous: EvalReport,
): ComparisonCompatibility {
  if (current.caseId !== previous.caseId) {
    return { comparable: false, reason: "condition_mismatch" };
  }

  // If either report lacks provenance or has null/missing model metadata
  const currentProv = current.provenance;
  const prevProv = previous.provenance;

  if (!hasComparisonMetadata(currentProv) || !hasComparisonMetadata(prevProv)) {
    return { comparable: false, reason: "missing_metadata" };
  }

  const conditionKeys = [
    "comparisonFingerprint",
    "caseFingerprint",
    "graderFingerprint",
    "actorModel",
    "judgeModel",
    "actorTimeoutMs",
    "judgeTimeoutMs",
    "hostVersion",
    "hostAdapter",
    "actorApi",
    "judgeApi",
    "actorThinkingLevel",
    "judgeThinkingLevel",
  ] as const;
  if (
    conditionKeys.some(
      (key) => (currentProv[key] ?? null) !== (prevProv[key] ?? null),
    )
  ) {
    return { comparable: false, reason: "condition_mismatch" };
  }

  return { comparable: true, reason: "conditions_match" };
}
