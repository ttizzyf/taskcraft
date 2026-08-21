import type { TaskcraftDatabase } from "../../store/database.js";
import type { TaskSnapshot } from "../../store/revision-guard.js";
import {
  L2_COMPILER_VERSION,
  L2_FACTS_DIGEST,
  L2_POLICY_DIGEST,
} from "../lifecycle/l2.js";
import {
  L3_COMPILER_VERSION,
  L3_FACTS_DIGEST,
  L3_POLICY_DIGEST,
} from "../lifecycle/l3.js";
import { materializeL1Graph } from "./l1-materialize.js";
import { materializeL2Graph } from "./l2-materialize.js";
import { materializeL3Graph } from "./l3-materialize.js";

export interface MaterializePlanningRevisionInput {
  snapshot: TaskSnapshot;
  newRevision: number;
  reasonCode: string;
  reason: string;
  changeSummary: Record<string, unknown>;
  actor: string;
  now: string;
}

/** Single owner for rebuilding the first graph of a new lifecycle revision. */
export function materializePlanningRevision(
  database: TaskcraftDatabase,
  input: MaterializePlanningRevisionInput,
): void {
  const common = {
    taskId: input.snapshot.id,
    revision: input.newRevision,
    reasonCode: input.reasonCode,
    reason: input.reason,
    changeSummary: input.changeSummary,
    objective: input.snapshot.objectiveMd,
    actor: input.actor,
    now: input.now,
  };
  if (input.snapshot.level === 3) {
    materializeL3Graph(database, {
      ...common,
      compilerVersion: L3_COMPILER_VERSION,
      factsDigest: L3_FACTS_DIGEST,
      policyDigest: L3_POLICY_DIGEST,
    });
  } else if (input.snapshot.level === 2) {
    materializeL2Graph(database, {
      ...common,
      compilerVersion: L2_COMPILER_VERSION,
      factsDigest: L2_FACTS_DIGEST,
      policyDigest: L2_POLICY_DIGEST,
    });
  } else {
    materializeL1Graph(database, common);
  }
}
