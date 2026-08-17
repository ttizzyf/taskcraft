import type { TaskShowData } from "./render.js";

/** Renders normalized L3 relations without deriving any lifecycle state. */
export function renderL3TaskShowSections(data: TaskShowData): string[] {
  return [
    ...renderChildren(data),
    ...renderAnchors(data),
    ...renderDependencies(data),
    ...renderValidations(data),
    "Execution source:",
    data.executionSource === null
      ? "  (none)"
      : `  ${data.executionSource.mode}  plan: ${data.executionSource.sourcePlanAttemptId}  feasibility review: ${data.executionSource.feasibilityReviewAttemptId}`,
    "Inherited planning:",
    data.inheritedPlanning === null
      ? "  (none)"
      : `  parent: ${data.inheritedPlanning.parentTaskId} rev ${data.inheritedPlanning.parentLifecycleRevision}  module: ${data.inheritedPlanning.moduleKey}  plan: ${data.inheritedPlanning.sourcePlanAttemptId}`,
  ];
}

function renderChildren(data: TaskShowData): string[] {
  if (data.children.length === 0) return ["Children:", "  (none)"];
  return [
    "Children:",
    ...data.children.map(
      (child) =>
        `  ${child.taskId}  ${child.requirementStatus}  ${child.status}  ${child.moduleKey}` +
        (child.waitingReason === null
          ? ""
          : `  waiting: ${child.waitingReason}`),
    ),
  ];
}

function renderAnchors(data: TaskShowData): string[] {
  if (data.anchors.length === 0) {
    return ["Acceptance anchors:", "  (none)"];
  }
  return [
    "Acceptance anchors:",
    ...data.anchors.map((anchor) => {
      const covered = data.coverage
        .filter((coverage) => coverage.anchorId === anchor.anchorId)
        .map((coverage) => coverage.childTaskId);
      return (
        `  ${anchor.anchorId}  ${anchor.disposition}  ${anchor.text}` +
        (covered.length === 0 ? "" : `  children: ${covered.join(", ")}`)
      );
    }),
  ];
}

function renderDependencies(data: TaskShowData): string[] {
  if (data.dependencies.length === 0) return ["Dependencies:", "  (none)"];
  return [
    "Dependencies:",
    ...data.dependencies.map(
      (dependency) =>
        `  ${dependency.taskId}  depends on  ${dependency.dependsOnTaskId}`,
    ),
  ];
}

function renderValidations(data: TaskShowData): string[] {
  if (data.validations.length === 0) {
    return ["Shared validations:", "  (none)"];
  }
  return [
    "Shared validations:",
    ...data.validations.map((validation) => {
      const owner =
        validation.ownerKind === "parent_integrate"
          ? "parent integrate"
          : validation.ownerChildTaskId;
      return `  ${validation.validationId}  owner: ${owner}  ${validation.reference}`;
    }),
  ];
}
