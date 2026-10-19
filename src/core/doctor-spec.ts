import type { LoadedSpecRegistry } from "../spec/types.js";
import { evaluateSpecBindingDrift } from "../spec/index.js";
import type { TaskcraftDatabase } from "../store/database.js";
import { getLifecycleSpecBindings, listTasks } from "../store/query.js";
import { ERROR_CODES } from "./errors.js";
import type { DoctorCheck } from "./doctor.js";
import { checkSpecImpact } from "./doctor-spec-impact.js";
import { checkSpecSedimentation } from "./doctor-spec-sedimentation.js";
import { project } from "./projector.js";
import { validateStoredNodeResult } from "./reducer/lifecycle-result.js";

export function runSpecStoreChecks(
  database: TaskcraftDatabase,
  registry: LoadedSpecRegistry | null,
): DoctorCheck[] {
  return [
    checkSpecBindings(database, registry),
    checkSpecImpact(database),
    checkSpecSedimentation(database),
  ];
}

function checkSpecBindings(
  database: TaskcraftDatabase,
  registry: LoadedSpecRegistry | null,
): DoctorCheck {
  const problems: string[] = [];
  for (const task of listTasks(database)) {
    const bindings = getLifecycleSpecBindings(database, task.id);
    for (const binding of bindings) {
      const source = binding.sourceAttemptId;
      if (
        binding.sourceKind === "task_create" &&
        binding.lifecycleRevision !== 1
      ) {
        problems.push(
          `${task.id} ${binding.nodeId}: invalid task_create revision`,
        );
      } else if (
        binding.sourceKind === "refresh" &&
        binding.lifecycleRevision <= 1
      ) {
        problems.push(`${task.id} ${binding.nodeId}: invalid refresh revision`);
      } else if (
        binding.sourceKind !== "task_create" &&
        binding.sourceKind !== "refresh" &&
        source === null
      ) {
        problems.push(`${task.id} ${binding.nodeId}: missing source attempt`);
      } else if (
        source !== null &&
        !hasExactBindingProvenance(database, binding)
      ) {
        problems.push(
          `${task.id} ${binding.nodeId}: invalid ${binding.sourceKind} provenance`,
        );
      }
    }
    if (registry !== null && !isFinished(database, task.id)) {
      // Only a required binding can block work, so only a required binding can
      // make the store unhealthy. A recommended binding is advisory context
      // that never gates anything; reporting its drift as a failure would turn
      // every Spec edit into permanent red noise.
      const gating = bindings.filter(
        (binding) =>
          binding.lifecycleRevision === task.currentLifecycleRevision &&
          binding.duty === "required",
      );
      for (const item of evaluateSpecBindingDrift(registry, gating)) {
        if (item.status === "stale") {
          problems.push(
            `${task.id} ${item.binding.nodeId} ${item.binding.specId}: ${item.reasons.join(", ")}`,
          );
        }
      }
    }
  }
  problems.push(...checkL3BindingSets(database));
  return problems.length === 0
    ? { name: "spec-bindings", ok: true }
    : failure(
        "spec-bindings",
        ERROR_CODES.TC_SPEC_BINDING_INVALID,
        `Invalid lifecycle Spec bindings: ${problems.join("; ")}`,
        "Current Node Briefs and drift gates cannot trust the stored binding snapshot",
        "Repair the Registry or Store facts, then re-run: tc doctor",
      );
}

/** Drift warns about work a task will still do under a changed contract, so a
 * finished task's binding is history and out of scope: comparing it with
 * today's Registry would report every past task forever, with no remedy.
 * Unprojectable tasks keep the comparison so the damage stays visible. */
function isFinished(database: TaskcraftDatabase, taskId: string): boolean {
  try {
    const status = project(database, taskId).status;
    return status === "done" || status === "cancelled";
  } catch {
    return false;
  }
}

function checkL3BindingSets(database: TaskcraftDatabase): string[] {
  const problems: string[] = [];
  const executionSources = database
    .prepare(
      `SELECT task_id AS taskId, lifecycle_revision AS revision, mode,
              source_plan_attempt_id AS planAttemptId
       FROM lifecycle_execution_sources`,
    )
    .all() as Array<{
    taskId: string;
    revision: number;
    mode: "modules" | "single";
    planAttemptId: string;
  }>;
  for (const source of executionSources) {
    const plan = readPlanResult(database, source.planAttemptId);
    if (plan === null) {
      problems.push(
        `${source.taskId} revision ${source.revision}: invalid accepted Plan result`,
      );
      continue;
    }
    const expectedNodes =
      source.mode === "modules"
        ? ["integrate-1", "record-1", "review-integrate-1"]
        : [
            "execute-1",
            "integrate-1",
            "record-1",
            "review-execute-1",
            "review-integrate-1",
          ];
    problems.push(
      ...bindingSetProblems(
        `${source.taskId} revision ${source.revision} accepted Plan`,
        getLifecycleSpecBindings(
          database,
          source.taskId,
          source.revision,
        ).filter((binding) => binding.sourceKind === "accepted_plan"),
        specSelections(plan.executionSpecs),
        expectedNodes,
      ),
    );
  }

  const inherited = database
    .prepare(
      `SELECT child_task_id AS taskId, child_lifecycle_revision AS revision,
              module_key AS moduleKey, source_plan_attempt_id AS planAttemptId
       FROM lifecycle_inherited_planning`,
    )
    .all() as Array<{
    taskId: string;
    revision: number;
    moduleKey: string;
    planAttemptId: string;
  }>;
  for (const source of inherited) {
    const plan = readPlanResult(database, source.planAttemptId);
    if (plan === null) {
      problems.push(
        `${source.taskId} inherited module ${source.moduleKey}: invalid source Plan result`,
      );
      continue;
    }
    const modules = Array.isArray(plan.modules) ? plan.modules : [];
    const module = modules.find(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as { key?: unknown }).key === source.moduleKey,
    ) as { specBindings?: unknown } | undefined;
    const expectedNodes = database
      .prepare(
        `SELECT id FROM lifecycle_nodes
         WHERE task_id = ? AND lifecycle_revision = ?
           AND kind IN ('execute', 'review', 'record') ORDER BY id`,
      )
      .all(source.taskId, source.revision)
      .map((row) => (row as { id: string }).id);
    problems.push(
      ...bindingSetProblems(
        `${source.taskId} inherited module ${source.moduleKey}`,
        getLifecycleSpecBindings(
          database,
          source.taskId,
          source.revision,
        ).filter((binding) => binding.sourceKind === "inherited_plan"),
        specSelections(module?.specBindings),
        expectedNodes,
      ),
    );
  }
  return problems;
}

function readPlanResult(
  database: TaskcraftDatabase,
  attemptId: string,
): Record<string, unknown> | null {
  const row = database
    .prepare(
      `SELECT task_id AS taskId, lifecycle_revision AS lifecycleRevision,
              node_id AS nodeId, status, outcome,
              result_json AS resultJson
       FROM node_attempts WHERE id = ?`,
    )
    .get(attemptId) as
    | {
        taskId: string;
        lifecycleRevision: number;
        nodeId: string;
        status: string;
        outcome: string | null;
        resultJson: string | null;
      }
    | undefined;
  if (
    row === undefined ||
    row.resultJson === null ||
    row.status !== "finished" ||
    row.outcome !== "success"
  ) {
    return null;
  }
  try {
    const result = JSON.parse(row.resultJson) as unknown;
    if (
      typeof result !== "object" ||
      result === null ||
      Array.isArray(result) ||
      !validateStoredNodeResult(
        database,
        row.taskId,
        row.lifecycleRevision,
        row.nodeId,
        result,
      )
    ) {
      return null;
    }
    return result as Record<string, unknown>;
  } catch {
    return null;
  }
}

function specSelections(value: unknown): Map<string, string> {
  if (!Array.isArray(value)) return new Map();
  return new Map(
    value.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const selection = item as { id?: unknown; duty?: unknown };
      return typeof selection.id === "string" &&
        typeof selection.duty === "string"
        ? [[selection.id, selection.duty] as const]
        : [];
    }),
  );
}

function bindingSetProblems(
  label: string,
  bindings: ReturnType<typeof getLifecycleSpecBindings>,
  expected: Map<string, string>,
  expectedNodes: string[],
): string[] {
  const problems: string[] = [];
  const actual = new Map<string, { snapshot: string; nodes: Set<string> }>();
  for (const binding of bindings) {
    const snapshot = [
      binding.specKind,
      binding.specPath,
      binding.specDigest,
      binding.duty,
    ].join(":");
    const current = actual.get(binding.specId);
    if (current !== undefined && current.snapshot !== snapshot) {
      problems.push(`${label}: inconsistent snapshot for ${binding.specId}`);
    }
    const entry = current ?? { snapshot, nodes: new Set<string>() };
    entry.nodes.add(binding.nodeId);
    actual.set(binding.specId, entry);
  }
  const actualSelections = new Map(
    [...actual].map(([id, entry]) => [id, entry.snapshot.split(":").at(-1)!]),
  );
  if (
    JSON.stringify([...actualSelections].sort()) !==
    JSON.stringify([...expected].sort())
  ) {
    problems.push(`${label}: stored bindings do not match accepted selections`);
  }
  const target = JSON.stringify([...expectedNodes].sort());
  for (const [id, entry] of actual) {
    if (JSON.stringify([...entry.nodes].sort()) !== target) {
      problems.push(`${label}: ${id} is not bound to every delivery node`);
    }
  }
  return problems;
}

function hasExactBindingProvenance(
  database: TaskcraftDatabase,
  binding: ReturnType<typeof getLifecycleSpecBindings>[number],
): boolean {
  const source = database
    .prepare(
      `SELECT attempt.task_id AS taskId, attempt.lifecycle_revision AS revision,
              node.kind, attempt.status, attempt.outcome
       FROM node_attempts AS attempt
       JOIN lifecycle_nodes AS node
         ON node.task_id = attempt.task_id
        AND node.lifecycle_revision = attempt.lifecycle_revision
        AND node.id = attempt.node_id
       WHERE attempt.id = ? AND attempt.task_id = ?`,
    )
    .get(binding.sourceAttemptId, binding.sourceTaskId) as
    | {
        taskId: string;
        revision: number;
        kind: string;
        status: string;
        outcome: string | null;
      }
    | undefined;
  const successful =
    source?.status === "finished" && source.outcome === "success";
  if (binding.sourceKind === "frame") {
    return (
      successful &&
      source?.taskId === binding.taskId &&
      source.revision === binding.lifecycleRevision &&
      source.kind === "frame"
    );
  }
  if (binding.sourceKind === "accepted_plan") {
    return (
      successful &&
      source?.kind === "plan" &&
      database
        .prepare(
          `SELECT 1 FROM lifecycle_execution_sources
           WHERE task_id = ? AND lifecycle_revision = ? AND source_plan_attempt_id = ?`,
        )
        .get(
          binding.taskId,
          binding.lifecycleRevision,
          binding.sourceAttemptId,
        ) !== undefined
    );
  }
  if (binding.sourceKind === "inherited_plan") {
    return (
      successful &&
      source?.kind === "plan" &&
      database
        .prepare(
          `SELECT 1 FROM lifecycle_inherited_planning
           WHERE child_task_id = ? AND child_lifecycle_revision = ?
             AND parent_task_id = ? AND source_plan_attempt_id = ?`,
        )
        .get(
          binding.taskId,
          binding.lifecycleRevision,
          binding.sourceTaskId,
          binding.sourceAttemptId,
        ) !== undefined
    );
  }
  return binding.sourceAttemptId === null && binding.sourceTaskId === null;
}

function failure(
  name: string,
  code: typeof ERROR_CODES.TC_SPEC_BINDING_INVALID,
  problem: string,
  impact: string,
  remediation: string,
): DoctorCheck {
  return { name, ok: false, error: { code, problem, impact, remediation } };
}
