// Pure mapping from a stored agent_runs row to the adapter observation view.
// All writes go through the runAttach reducer; adapters never write SQLite.

import type { HostRun, RuntimeObservation } from "./types.js";

/** Pure observation mapping: stamps a fresh last-seen on the run and keeps
 * the observed status; never maps to task completion. */
export function observeRun(
  run: HostRun,
  now: () => string,
): RuntimeObservation {
  const observation: RuntimeObservation = {
    status: run.observationStatus,
    lastSeenAt: run.lastSeenAt ?? now(),
  };

  if (run.finishReason !== null) {
    observation.finishReason = run.finishReason;
  }

  return observation;
}
