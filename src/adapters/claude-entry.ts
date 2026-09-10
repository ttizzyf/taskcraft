import { createContractValidators } from "../contracts/schemas.js";
import type { ContractValidators } from "../contracts/schemas.js";

let validators: ContractValidators | undefined;

/** Only host SessionStart responses are injection evidence, never model text. */
export function inspectClaudeEntryOutput(stdout: string): string | null {
  let injected = false;
  let completed = false;
  for (const line of stdout.split(/\r?\n/).filter((line) => line.trim())) {
    const event = parseObject(line);
    if (event === null) {
      return "Claude stream-json is malformed; tc-breadcrumb/v1 injection unverified";
    }
    if (event.type === "result") {
      if (event.subtype !== "success" || event.is_error !== false) {
        return "Claude model result did not complete successfully";
      }
      completed = true;
    }
    if (
      event.type !== "system" ||
      event.subtype !== "hook_response" ||
      event.hook_event !== "SessionStart"
    )
      continue;
    if (event.exit_code !== 0 || event.outcome !== "success") {
      return "Claude SessionStart Hook failed";
    }
    if (typeof event.stdout === "string") {
      const validateBreadcrumb = (validators ??= createContractValidators())
        .breadcrumb;
      injected ||= event.stdout.split(/\r?\n/).some((line) => {
        const breadcrumb = parseObject(line);
        return breadcrumb !== null && validateBreadcrumb(breadcrumb);
      });
    }
  }
  if (!injected) return "Claude SessionStart missing valid tc-breadcrumb/v1";
  return completed ? null : "Claude stream missing successful model result";
}

function parseObject(text: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
