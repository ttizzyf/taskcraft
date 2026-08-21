import type { SpecSelection } from "../../spec/bindings.js";

// Typed accepted-plan contract and semantic validation. JSON Schema owns the
// payload shape; this module owns relationships that JSON Schema cannot prove.

export interface L3FrameResult {
  objective: string;
  scope: string[];
  acceptanceAnchors: Array<{ id: string; text: string }>;
  nonGoals: string[];
}

export interface L3ModuleProposal {
  key: string;
  reuseTaskId?: string;
  title: string;
  level: 1 | 2;
  reason: string;
  objective: string;
  scope: string[];
  acceptance: string[];
  nonGoals: string[];
  covers: string[];
  reviewFocus: string[];
  specBindings: SpecSelection[];
}

export interface L3PlanResult {
  decomposition: {
    mode: "modules" | "single";
    reason: string;
    attemptedSplits: Array<{ proposal: string; failureReason: string }>;
  };
  modules: L3ModuleProposal[];
  coverage: Array<{
    anchorId: string;
    disposition: "required" | "deferred" | "descope";
    moduleKeys: string[];
    reason?: string;
  }>;
  dependencies: Array<{ task: string; dependsOn: string }>;
  executionMode: "serial" | "parallel" | "hybrid";
  sharedValidations: Array<{
    id: string;
    reference: string;
    owner: string;
  }>;
  integrationPath: string;
  executionSpecs: SpecSelection[];
}

export interface L3ContractValidation {
  valid: boolean;
  problems: string[];
}

export function validateL3PlanContract(
  frame: L3FrameResult,
  plan: L3PlanResult,
): L3ContractValidation {
  const problems: string[] = [];
  const anchorIds = uniqueIds(
    frame.acceptanceAnchors.map((anchor) => anchor.id),
    "acceptance anchor",
    problems,
  );
  const moduleKeys = uniqueIds(
    plan.modules.map((module) => module.key),
    "module key",
    problems,
  );

  validateMode(plan, problems);
  validateSpecSelections(plan, problems);
  validateReuse(plan, problems);
  validateCoverage(frame, plan, anchorIds, moduleKeys, problems);
  validateDependencies(plan, moduleKeys, problems);
  validateValidations(plan, moduleKeys, problems);

  return { valid: problems.length === 0, problems };
}

function validateSpecSelections(plan: L3PlanResult, problems: string[]): void {
  validateUniqueSpecSet(plan.executionSpecs, "parent execution", problems);
  for (const module of plan.modules) {
    validateUniqueSpecSet(
      module.specBindings,
      `module ${module.key}`,
      problems,
    );
  }
}

function validateUniqueSpecSet(
  selections: SpecSelection[],
  label: string,
  problems: string[],
): void {
  const seen = new Set<string>();
  for (const selection of selections) {
    if (seen.has(selection.id)) {
      problems.push(`${label} Spec ${selection.id} is duplicated`);
    }
    seen.add(selection.id);
  }
}

function validateReuse(plan: L3PlanResult, problems: string[]): void {
  uniqueIds(
    plan.modules.flatMap((module) =>
      module.reuseTaskId === undefined ? [] : [module.reuseTaskId],
    ),
    "reused child task",
    problems,
  );
}

function validateMode(plan: L3PlanResult, problems: string[]): void {
  if (plan.decomposition.mode === "modules" && plan.modules.length < 2) {
    problems.push("modules mode requires at least two modules");
  }

  if (plan.decomposition.mode === "single") {
    if (plan.modules.length !== 0) {
      problems.push("single mode cannot declare modules");
    }
    if (plan.decomposition.attemptedSplits.length === 0) {
      problems.push("single mode requires at least one attempted split");
    }
    if (plan.dependencies.length > 0) {
      problems.push("single mode cannot declare child dependencies");
    }
  }
}

function validateCoverage(
  frame: L3FrameResult,
  plan: L3PlanResult,
  anchorIds: Set<string>,
  moduleKeys: Set<string>,
  problems: string[],
): void {
  const coverageIds = uniqueIds(
    plan.coverage.map((coverage) => coverage.anchorId),
    "coverage anchor",
    problems,
  );

  for (const coverage of plan.coverage) {
    if (!anchorIds.has(coverage.anchorId)) {
      problems.push(`coverage references unknown anchor ${coverage.anchorId}`);
    }
    const coveredModules = uniqueIds(
      coverage.moduleKeys,
      `coverage module for ${coverage.anchorId}`,
      problems,
    );
    for (const key of coveredModules) {
      if (!moduleKeys.has(key)) {
        problems.push(`coverage references unknown module ${key}`);
      }
    }

    if (
      plan.decomposition.mode === "modules" &&
      coverage.disposition === "required" &&
      coverage.moduleKeys.length === 0
    ) {
      problems.push(
        `required anchor ${coverage.anchorId} has no module coverage`,
      );
    }
    if (
      coverage.disposition !== "required" &&
      (coverage.reason === undefined || coverage.reason.trim() === "")
    ) {
      problems.push(
        `${coverage.disposition} anchor ${coverage.anchorId} requires a reason`,
      );
    }
    if (coverage.disposition !== "required" && coverage.moduleKeys.length > 0) {
      problems.push(
        `${coverage.disposition} anchor ${coverage.anchorId} cannot cover modules`,
      );
    }
  }

  for (const anchor of frame.acceptanceAnchors) {
    if (!coverageIds.has(anchor.id)) {
      problems.push(`anchor ${anchor.id} is missing from coverage`);
    }
  }

  for (const module of plan.modules) {
    const declared = new Set(module.covers);
    const mapped = new Set(
      plan.coverage
        .filter((coverage) => coverage.moduleKeys.includes(module.key))
        .map((coverage) => coverage.anchorId),
    );
    if (!sameSet(declared, mapped)) {
      problems.push(
        `module ${module.key} covers does not match the coverage map`,
      );
    }
    for (const anchorId of declared) {
      if (!anchorIds.has(anchorId)) {
        problems.push(`module ${module.key} covers unknown anchor ${anchorId}`);
      }
    }
  }
}

function validateDependencies(
  plan: L3PlanResult,
  moduleKeys: Set<string>,
  problems: string[],
): void {
  const dependencies = new Map<string, Set<string>>();
  const edgeKeys = new Set<string>();

  for (const dependency of plan.dependencies) {
    if (!moduleKeys.has(dependency.task)) {
      problems.push(`dependency references unknown module ${dependency.task}`);
    }
    if (!moduleKeys.has(dependency.dependsOn)) {
      problems.push(
        `dependency references unknown module ${dependency.dependsOn}`,
      );
    }
    if (dependency.task === dependency.dependsOn) {
      problems.push(`module ${dependency.task} cannot depend on itself`);
    }
    const edgeKey = `${dependency.task}\u0000${dependency.dependsOn}`;
    if (edgeKeys.has(edgeKey)) {
      problems.push(
        `dependency ${dependency.task} -> ${dependency.dependsOn} is duplicated`,
      );
    }
    edgeKeys.add(edgeKey);
    const targets = dependencies.get(dependency.task) ?? new Set<string>();
    targets.add(dependency.dependsOn);
    dependencies.set(dependency.task, targets);
  }

  if (hasCycle(moduleKeys, dependencies)) {
    problems.push("module dependencies contain a cycle");
  }
}

function validateValidations(
  plan: L3PlanResult,
  moduleKeys: Set<string>,
  problems: string[],
): void {
  uniqueIds(
    plan.sharedValidations.map((validation) => validation.id),
    "shared validation",
    problems,
  );
  for (const validation of plan.sharedValidations) {
    if (
      validation.owner !== "parent-integrate" &&
      !moduleKeys.has(validation.owner)
    ) {
      problems.push(
        `validation ${validation.id} has unknown owner ${validation.owner}`,
      );
    }
    if (
      plan.decomposition.mode === "single" &&
      validation.owner !== "parent-integrate"
    ) {
      problems.push(
        `single mode validation ${validation.id} must be owned by parent-integrate`,
      );
    }
  }
}

function uniqueIds(
  values: string[],
  label: string,
  problems: string[],
): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    if (result.has(value)) {
      problems.push(`${label} ${value} is duplicated`);
    }
    result.add(value);
  }
  return result;
}

function hasCycle(
  nodes: Set<string>,
  dependencies: Map<string, Set<string>>,
): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const dependency of dependencies.get(node) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return [...nodes].some(visit);
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}
