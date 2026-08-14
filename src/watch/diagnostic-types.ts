/** Watch-local codes for anomalies the core taxonomy does not name. */
export const WATCH_DIAGNOSTIC_CODES = {
  TC_RETRIES_EXHAUSTED: "TC_RETRIES_EXHAUSTED",
  TC_OBSERVATION_STALE: "TC_OBSERVATION_STALE",
  TC_ENTRY_HOOK_TEST_MISSING: "TC_ENTRY_HOOK_TEST_MISSING",
  TC_ENTRY_HOOK_REGISTRATION_INVALID: "TC_ENTRY_HOOK_REGISTRATION_INVALID",
  TC_ENTRY_HOOK_VERSION_DRIFT: "TC_ENTRY_HOOK_VERSION_DRIFT",
} as const;

export type DiagnosticSource = "store" | "migration" | "adapter" | "task";

export interface DiagnosticItem {
  code: string;
  problem: string;
  impact: string;
  remediation: string;
  source: DiagnosticSource;
}
