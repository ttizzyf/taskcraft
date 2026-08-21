import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import type { LifecycleSpecBindingRow } from "../store/spec-facts.js";
import type { LoadedSpecRegistry } from "./types.js";
import { assertRepositoryRelativePath } from "./paths.js";

export type SpecDuty = "required" | "recommended";

export interface SpecSelection {
  id: string;
  duty: SpecDuty;
}

/** Filesystem-free snapshot accepted by reducers and persisted in SQLite. */
export interface ResolvedSpecBinding {
  specId: string;
  kind: "engineering" | "domain";
  path: string;
  digest: string;
  duty: SpecDuty;
}

export type SpecBindingDriftReason =
  | "missing"
  | "deprecated"
  | "kind_changed"
  | "path_changed"
  | "digest_changed"
  | "registry_unavailable";

export interface SpecBindingDrift {
  binding: LifecycleSpecBindingRow;
  status: "current" | "stale";
  reasons: SpecBindingDriftReason[];
}

/** Decodes the public `{id,duty}[]` selection at the command boundary. */
export function parseSpecSelections(
  value: unknown,
  context: string,
): SpecSelection[] {
  if (!Array.isArray(value)) {
    throw bindingInvalid(`${context} must be an array of {id, duty} objects`);
  }

  const selections = value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw bindingInvalid(`${context} item ${index + 1} must be an object`);
    }
    const keys = Object.keys(item);
    const { id, duty } = item as Record<string, unknown>;
    if (
      keys.some((key) => key !== "id" && key !== "duty") ||
      typeof id !== "string" ||
      id.trim() === "" ||
      (duty !== "required" && duty !== "recommended")
    ) {
      throw bindingInvalid(
        `${context} item ${index + 1} must contain only a non-empty id and duty required|recommended`,
      );
    }
    return { id, duty: duty as SpecDuty };
  });

  assertUniqueSelections(selections, context);
  return selections;
}

/** Resolves explicitly selected active ids from one already-loaded Registry. */
export function resolveSpecSelections(
  registry: LoadedSpecRegistry,
  selections: readonly SpecSelection[],
): ResolvedSpecBinding[] {
  assertUniqueSelections(selections, "Spec selection");
  const byId = new Map(registry.specs.map((spec) => [spec.id, spec]));

  return selections.map((selection) => {
    const spec = byId.get(selection.id);
    if (spec === undefined) {
      throw bindingInvalid(
        `Selected Spec ${selection.id} is not present in the Registry`,
      );
    }
    if (spec.status !== "active") {
      throw bindingInvalid(
        `Selected Spec ${selection.id} is deprecated and cannot form a new binding`,
      );
    }
    return {
      specId: spec.id,
      kind: spec.kind,
      path: spec.path,
      digest: spec.digest,
      duty: selection.duty,
    };
  });
}

/** Reducer-side structural check: snapshots must exactly cover the proposal. */
export function assertResolvedSpecSelections(
  selections: readonly SpecSelection[],
  resolved: readonly ResolvedSpecBinding[],
  context: string,
): void {
  assertUniqueSelections(selections, context);
  assertResolvedBindings(resolved, context);
  const expected = selections
    .map((selection) => `${selection.id}\u0000${selection.duty}`)
    .sort();
  const actual = resolved
    .map((binding) => `${binding.specId}\u0000${binding.duty}`)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw bindingInvalid(
      `${context} resolved snapshots do not match the selected Spec id/duty set`,
    );
  }
}

export function assertResolvedBindings(
  bindings: readonly ResolvedSpecBinding[],
  context: string,
): void {
  if (!Array.isArray(bindings)) {
    throw bindingInvalid(`${context} must be an array of resolved snapshots`);
  }
  const seen = new Set<string>();
  for (const binding of bindings) {
    if (
      typeof binding !== "object" ||
      binding === null ||
      Array.isArray(binding)
    ) {
      throw bindingInvalid(`${context} contains an invalid resolved snapshot`);
    }
    const keys = Object.keys(binding);
    if (
      keys.length !== 5 ||
      keys.some(
        (key) =>
          key !== "specId" &&
          key !== "kind" &&
          key !== "path" &&
          key !== "digest" &&
          key !== "duty",
      ) ||
      typeof binding.specId !== "string" ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(binding.specId) ||
      typeof binding.path !== "string" ||
      (binding.kind !== "engineering" && binding.kind !== "domain") ||
      (binding.duty !== "required" && binding.duty !== "recommended") ||
      typeof binding.digest !== "string" ||
      !/^[0-9a-f]{64}$/.test(binding.digest)
    ) {
      throw bindingInvalid(`${context} contains an invalid resolved snapshot`);
    }
    try {
      assertRepositoryRelativePath(binding.path, `${context} path`);
    } catch {
      throw bindingInvalid(
        `${context} contains a non-canonical repository-relative path`,
      );
    }
    if (seen.has(binding.specId)) {
      throw bindingInvalid(`${context} repeats Spec ${binding.specId}`);
    }
    seen.add(binding.specId);
  }
}

export function selectionsFromBindingRows(
  bindings: readonly LifecycleSpecBindingRow[],
): SpecSelection[] {
  const byId = new Map<string, SpecDuty>();
  for (const binding of bindings) {
    const current = byId.get(binding.specId);
    if (current !== undefined && current !== binding.duty) {
      throw bindingInvalid(
        `Spec ${binding.specId} has inconsistent duties in the lifecycle revision`,
      );
    }
    byId.set(binding.specId, binding.duty);
  }
  return [...byId].map(([id, duty]) => ({ id, duty }));
}

export function evaluateSpecBindingDrift(
  registry: LoadedSpecRegistry,
  bindings: readonly LifecycleSpecBindingRow[],
): SpecBindingDrift[] {
  const currentById = new Map(registry.specs.map((spec) => [spec.id, spec]));
  return bindings.map((binding) => {
    const current = currentById.get(binding.specId);
    const reasons: SpecBindingDriftReason[] = [];
    if (current === undefined) {
      reasons.push("missing");
    } else {
      if (current.status !== "active") reasons.push("deprecated");
      if (current.kind !== binding.specKind) reasons.push("kind_changed");
      if (current.path !== binding.specPath) reasons.push("path_changed");
      if (current.digest !== binding.specDigest) reasons.push("digest_changed");
    }
    return {
      binding,
      status: reasons.length === 0 ? "current" : "stale",
      reasons,
    };
  });
}

export function staleRequiredBindingsError(
  taskId: string,
  drift: readonly SpecBindingDrift[],
): TaskcraftError {
  const stale = drift.filter(
    (item) => item.status === "stale" && item.binding.duty === "required",
  );
  return new TaskcraftError(ERROR_CODES.TC_SPEC_BINDING_STALE, {
    problem: `Required Spec bindings are stale: ${stale
      .map((item) => `${item.binding.specId} (${item.reasons.join(", ")})`)
      .join("; ")}`,
    impact: "No Execute or Review attempt was created",
    remediation: `Review the current Specs, then run: tc task spec refresh ${taskId} --reason <reason>`,
    context: { taskId, staleCount: stale.length },
  });
}

function assertUniqueSelections(
  selections: readonly SpecSelection[],
  context: string,
): void {
  const seen = new Set<string>();
  for (const selection of selections) {
    if (
      selection.id.trim() === "" ||
      (selection.duty !== "required" && selection.duty !== "recommended")
    ) {
      throw bindingInvalid(`${context} contains an invalid Spec selection`);
    }
    if (seen.has(selection.id)) {
      throw bindingInvalid(`${context} repeats Spec ${selection.id}`);
    }
    seen.add(selection.id);
  }
}

function bindingInvalid(problem: string): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_SPEC_BINDING_INVALID, {
    problem,
    impact: "No lifecycle Spec facts were written",
    remediation:
      "Select active Registry ids with duty required or recommended, then retry the command",
  });
}
