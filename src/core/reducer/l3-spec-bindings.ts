import {
  assertResolvedSpecSelections,
  type ResolvedSpecBinding,
} from "../../spec/bindings.js";
import type { TaskcraftDatabase } from "../../store/database.js";
import { insertLifecycleSpecBindings } from "../../store/spec-facts.js";
import { ERROR_CODES, TaskcraftError } from "../errors.js";
import type { L3PlanResult } from "../lifecycle/l3-contract.js";
import { isSpecBindingL3CompilerVersion } from "../lifecycle/l3.js";
import { invalidL3Plan } from "./l3-accepted-relations.js";

export interface AcceptedPlanSpecBindings {
  execution: ResolvedSpecBinding[];
  modules: Record<string, ResolvedSpecBinding[]>;
}

export function insertAcceptedPlanSpecBindings(
  database: TaskcraftDatabase,
  input: {
    taskId: string;
    lifecycleRevision: number;
    mode: "modules" | "single";
    planAttemptId: string;
    bindings: ResolvedSpecBinding[];
    actor: string;
    now: string;
  },
): void {
  insertLifecycleSpecBindings(database, {
    taskId: input.taskId,
    lifecycleRevision: input.lifecycleRevision,
    nodeIds:
      input.mode === "modules"
        ? ["integrate-1", "review-integrate-1", "record-1"]
        : [
            "execute-1",
            "review-execute-1",
            "integrate-1",
            "review-integrate-1",
            "record-1",
          ],
    bindings: input.bindings,
    source: {
      kind: "accepted_plan",
      taskId: input.taskId,
      attemptId: input.planAttemptId,
    },
    actor: input.actor,
    now: input.now,
  });
}

export function normalizePlanSpecSelections(
  plan: L3PlanResult,
  compilerVersion: string,
): L3PlanResult {
  if (isSpecBindingL3CompilerVersion(compilerVersion)) return plan;
  return {
    ...plan,
    executionSpecs: [],
    modules: plan.modules.map((module) => ({
      ...module,
      specBindings: [],
    })),
  };
}

export function validateAcceptedSpecBindings(
  taskId: string,
  plan: L3PlanResult,
  accepted: AcceptedPlanSpecBindings | undefined,
  compilerVersion: string,
): AcceptedPlanSpecBindings {
  const resolved = isSpecBindingL3CompilerVersion(compilerVersion)
    ? accepted
    : emptyResolvedModules(plan);
  if (resolved === undefined) {
    if (
      plan.executionSpecs.length === 0 &&
      plan.modules.every((module) => module.specBindings.length === 0)
    ) {
      return emptyResolvedModules(plan);
    }
    throw new TaskcraftError(ERROR_CODES.TC_SPEC_BINDING_INVALID, {
      problem:
        "Accepted Plan Spec selections were not resolved at the command boundary",
      impact:
        "The review pass, execution revision and all child facts were rolled back",
      remediation:
        "Resolve every selected parent and module Spec from the active Registry, then retry Feasibility Review",
      context: { taskId },
    });
  }
  assertResolvedSpecSelections(
    plan.executionSpecs,
    resolved.execution,
    "L3 execution Specs",
  );
  const expectedKeys = [...plan.modules.map((module) => module.key)].sort();
  const actualKeys = Object.keys(resolved.modules).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw invalidL3Plan(taskId, [
      "resolved module Spec bindings do not match the accepted module keys",
    ]);
  }
  for (const module of plan.modules) {
    assertResolvedSpecSelections(
      module.specBindings,
      resolved.modules[module.key] ?? [],
      `L3 module ${module.key} Specs`,
    );
  }
  return resolved;
}

function emptyResolvedModules(plan: L3PlanResult): AcceptedPlanSpecBindings {
  return {
    execution: [],
    modules: Object.fromEntries(plan.modules.map((module) => [module.key, []])),
  };
}
