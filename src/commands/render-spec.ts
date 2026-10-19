import type { SpecDeliveryView } from "../spec/index.js";

export function renderSpecDelivery(specs: SpecDeliveryView): string[] {
  const lines = ["Specs:"];
  if (specs.bindings.length === 0) {
    lines.push("  Bindings: (none)");
  } else {
    lines.push("  Bindings:");
    for (const binding of specs.bindings) {
      lines.push(
        `    ${binding.nodeId}  ${binding.id}  ${binding.kind}/${binding.duty}  ${binding.path}`,
      );
    }
  }
  if (specs.impacts.length === 0) {
    lines.push("  Impact: (none)");
  } else {
    lines.push("  Impact:");
    for (const impact of specs.impacts) {
      lines.push(
        `    ${impact.recordAttemptId}  ${impact.result.outcome}  ${JSON.stringify(impact.result)}`,
      );
    }
  }
  return lines;
}
