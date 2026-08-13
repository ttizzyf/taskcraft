// HostAdapter contract (architecture.md §9 + parent design "HostAdapter
// Contract"). Capabilities/installEntry/testHook never crash a command:
// failures are reported through explicit result fields, not exceptions.

import type { TaskcraftDatabase } from "../store/database.js";
import type { NodeBriefInput, RenderedNodeBrief } from "../core/node-brief.js";

export type {
  NodeBriefInput,
  RenderedNodeBrief as NodeBrief,
} from "../core/node-brief.js";

export type CapabilityName =
  "session-start" | "stop" | "structured-output" | "run-correlation";

export interface AdapterCapabilityItem {
  name: CapabilityName;
  available: boolean;
  /** Failure reason or a "limited" note for capabilities that are not a
   * version-level guarantee. */
  limitation?: string;
}

export interface AdapterCapabilities {
  host: string;
  /** null when the version probe failed. */
  version: string | null;
  items: AdapterCapabilityItem[];
  /** Last test-hook timestamp, set by hook-wiring; absent before the first
   * field test. */
  testedAt?: string;
}

export interface ProbeOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface SpawnOptions {
  cwd: string;
  timeoutMs: number;
  /** stdin payload for the spawned process (e.g. the stop hook re-entry
   * payload the hosts feed back as `stop_hook_active=true`). */
  input?: string;
}

export interface SpawnOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  error?: string;
}

export interface CapabilityProbe {
  name: CapabilityName;
  /** Any keyword found in the combined probe text marks the capability as
   * evidenced; no match means available=false, never an assumption. */
  keywords: string[];
  /** Static "limited" note attached when the probe matches. */
  note?: string;
}

export type ProbeFn = (command: string, args: string[]) => ProbeOutcome;
export type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => SpawnOutcome;

/** Injectable seams: tests substitute probe/spawn with fakes; the database
 * seam lets attachObservation reuse the store write path. */
export interface AdapterDeps {
  probe?: ProbeFn;
  spawn?: SpawnFn;
  now?: () => string;
  database?: TaskcraftDatabase;
  /** Codex user config path read by the test-hook trust gate; tests inject a
   * temporary file instead of touching ~/.codex/config.toml (read-only). */
  userConfigPath?: string;
}

export interface InstallInput {
  projectDir: string;
  takeOver: "off" | "ask" | "always";
}

export interface InstallResult {
  ok: boolean;
  hookPaths: string[];
  limitation?: string;
}

export interface HookTestInput {
  projectDir: string;
  /** Installed entry wrapper (.taskcraft/hooks/entry.sh). test-hook never
   * reinstalls a temporary copy: the installed scripts are exercised. */
  entryScript: string;
  /** Installed stop wrapper (.taskcraft/hooks/stop.sh). */
  stopScript: string;
  timeoutMs?: number;
  prompt?: string;
  /** Host-specific pre-flight gate (codex feature/trust); null when
   * satisfied, otherwise the failure reason. */
  gate?: () => string | null;
}

export interface HookTestResult {
  ok: boolean;
  entryInjected: boolean;
  stopBlocked: boolean;
  loopGuardOk: boolean;
  /** enforced = entry injection + stop block + loop guard all passed. */
  enforced: boolean;
  testedAt: string;
  failure?: string;
  sample?: string;
}

export type ObservationStatus =
  "pending" | "running" | "stale" | "finished" | "failed" | "unsupported";

export interface AttachInput {
  taskId: string;
  nodeAttemptId: string;
  host: string;
  hostRunId?: string;
  hostSessionId?: string;
  observationStatus?: ObservationStatus;
  lastSeenAt?: string;
  finishReason?: string;
  observation?: unknown;
}

export interface HostRun {
  id: string;
  taskId: string;
  nodeAttemptId: string;
  host: string;
  hostRunId: string | null;
  hostSessionId: string | null;
  observationStatus: ObservationStatus;
  lastSeenAt: string | null;
  finishReason: string | null;
  observationJson: string;
}

export interface RuntimeObservation {
  status: ObservationStatus;
  lastSeenAt?: string;
  finishReason?: string;
}

export interface HostAdapter {
  id: "codex" | "claude";
  capabilities(): AdapterCapabilities;
  installEntry(input: InstallInput): InstallResult;
  testHook(input: HookTestInput): HookTestResult;
  renderNodeBrief(input: NodeBriefInput): RenderedNodeBrief;
  attachObservation?(input: AttachInput): HostRun;
  observe?(run: HostRun): RuntimeObservation;
}
