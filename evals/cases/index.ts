import type { EvalCase } from "../core/types.ts";
import { deliveryCase } from "./delivery.ts";
import { l2ReviewCase } from "./l2-review.ts";
import { recoveryCase } from "./recovery.ts";
import { reviewCase } from "./review.ts";
import { sessionResumeCase } from "./session-resume.ts";

export const CASES: readonly EvalCase[] = [
  deliveryCase,
  recoveryCase,
  reviewCase,
  l2ReviewCase,
  sessionResumeCase,
];

export function findCase(id: string): EvalCase | undefined {
  return CASES.find((candidate) => candidate.id === id);
}
