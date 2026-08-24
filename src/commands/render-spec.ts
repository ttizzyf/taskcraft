import type { SpecDeliveryView } from "../spec/index.js";

export function renderSpecDelivery(specs: SpecDeliveryView): string[] {
  const lines = ["Specs:"];
  if (specs.registryIssue !== null) {
    lines.push(
      `  Registry: ${specs.registryIssue.code}  ${specs.registryIssue.problem}`,
      `  Remediation: ${specs.registryIssue.remediation}`,
    );
  }
  if (specs.bindings.length === 0) {
    lines.push("  Bindings: (none)");
  } else {
    lines.push("  Bindings:");
    for (const binding of specs.bindings) {
      const drift =
        binding.drift.status === "current"
          ? "current"
          : `stale: ${binding.drift.reasons.join(", ")}`;
      lines.push(
        `    ${binding.nodeId}  ${binding.id}  ${binding.kind}/${binding.duty}  ${binding.path}  sha256:${binding.digest}  ${drift}`,
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
