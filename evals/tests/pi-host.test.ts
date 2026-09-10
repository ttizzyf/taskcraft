import { describe, expect, it } from "vitest";

import {
  PI_EVAL_MODEL,
  PI_EVAL_MODEL_ID,
  PI_EVAL_PROVIDER,
  PI_EVAL_THINKING_LEVEL,
  classifyPi,
  parsePiModel,
  parsePiResult,
  type PiWireResult,
} from "../hosts/pi.ts";

function wireResult(patch: Partial<PiWireResult> = {}): PiWireResult {
  return {
    protocol: "tc-eval/pi-v1",
    status: "success",
    resultText: "done",
    callCount: 2,
    hostVersion: "pi-sdk@1.0.0",
    request: {
      provider: PI_EVAL_PROVIDER,
      modelId: PI_EVAL_MODEL_ID,
      thinkingLevel: PI_EVAL_THINKING_LEVEL,
      tools: ["read", "bash"],
    },
    observed: {
      provider: PI_EVAL_PROVIDER,
      model: PI_EVAL_MODEL_ID,
      api: "openai-responses",
      providerThinkingLevel: "max",
      stopReason: "stop",
      usage: { totalTokens: 3 },
    },
    diagnostics: [],
    ...patch,
  };
}

describe("Pi Evals host protocol", () => {
  it("normalizes the explicit Luna/max model request", () => {
    expect(parsePiModel(PI_EVAL_MODEL)).toEqual({
      provider: PI_EVAL_PROVIDER,
      modelId: PI_EVAL_MODEL_ID,
      thinkingLevel: PI_EVAL_THINKING_LEVEL,
      requested: PI_EVAL_MODEL,
    });
    expect(parsePiModel("company/gpt-5.6-luna").thinkingLevel).toBe("max");
    expect(parsePiModel(undefined).requested).toBe(PI_EVAL_MODEL);
  });

  it("rejects model or thinking-level drift", () => {
    expect(() => parsePiModel("openai/gpt-5.6-luna:max")).toThrow(
      "require company/gpt-5.6-luna:max",
    );
    expect(() => parsePiModel("company/gpt-5.6-luna:high")).toThrow(
      "require thinking level max",
    );
  });

  it("extracts the marked worker result after non-protocol output", () => {
    const result = wireResult();
    expect(parsePiResult(`sdk log\n${JSON.stringify(result)}\n`)).toEqual(
      result,
    );
    expect(parsePiResult("not-json\n")).toBeNull();
  });

  it("requires a clean worker result and preserves controller outcomes", () => {
    expect(classifyPi(0, wireResult(), false, false)).toBe("success");
    expect(classifyPi(0, wireResult({ status: "error" }), false, false)).toBe(
      "error",
    );
    expect(classifyPi(1, wireResult(), false, false)).toBe("error");
    expect(classifyPi(0, null, false, false)).toBe("invalid");
    expect(classifyPi(0, wireResult(), true, false)).toBe("interrupted");
    expect(classifyPi(0, wireResult(), false, true)).toBe("timeout");
  });
});
