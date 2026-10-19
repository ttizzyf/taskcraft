// Post-completion Spec sedimentation.
//
// A sedimentation names the Spec documents a finished task touched. It carries
// no content digest and no evidence reference: the documents themselves are the
// artifact, and the record is a note about what happened rather than a claim to
// be re-checked against today's Registry later.

import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import type { LoadedSpecRegistry } from "./types.js";

/** Shape check shared by the command boundary and the reducer transaction. */
export function parseSpecSedimentationIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw sedimentationInvalid(
      "Spec sedimentation requires at least one Spec id",
    );
  }

  const specIds = value.map((item) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw sedimentationInvalid(
        "Spec sedimentation Spec ids must be non-empty strings",
      );
    }
    return item;
  });

  if (new Set(specIds).size !== specIds.length) {
    throw sedimentationInvalid("Spec sedimentation repeats a Spec id");
  }

  return specIds;
}

/** Command-boundary resolution. Reducers never read the Registry, so they
 * receive the resolved list.
 *
 * Only existence is required, never `status: active`: a task may legitimately
 * sediment a Spec it just deprecated, and demanding today's status would be the
 * same present-tense judgement this record is designed to avoid. */
export function resolveSpecSedimentationIds(
  registry: LoadedSpecRegistry,
  value: unknown,
): string[] {
  const specIds = parseSpecSedimentationIds(value);
  const registered = new Set(registry.specs.map((spec) => spec.id));

  for (const specId of specIds) {
    if (!registered.has(specId)) {
      throw sedimentationInvalid(
        `Spec ${specId} is not present in the Registry`,
      );
    }
  }

  return specIds;
}

export function sedimentationInvalid(
  problem: string,
  cause?: unknown,
): TaskcraftError {
  return new TaskcraftError(ERROR_CODES.TC_SPEC_SEDIMENTATION_INVALID, {
    problem,
    impact: "No Spec sedimentation fact was written",
    remediation:
      "Record sediment for a done task with: tc task spec sediment <task> --reason <reason> --spec <spec-id>",
    ...(cause === undefined ? {} : { cause }),
  });
}
