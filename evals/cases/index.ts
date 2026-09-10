import type { EvalCase } from "../core/types.ts";
import { deliveryCase } from "./delivery.ts";
import { recoveryCase } from "./recovery.ts";
import { reviewCase } from "./review.ts";

export const CASES: readonly EvalCase[] = [
  deliveryCase,
  recoveryCase,
  reviewCase,
];

export function findCase(id: string): EvalCase | undefined {
  return CASES.find((candidate) => candidate.id === id);
}
