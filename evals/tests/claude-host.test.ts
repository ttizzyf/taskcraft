import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { classify, parseStream, runClaude } from "../hosts/claude.ts";

describe("host interruption", () => {
  it("escalates a checkpoint stop without reclassifying it as a timeout", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tc-eval-host-stop-"));
    writeFileSync(
      join(directory, "claude"),
      `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  console.log("fake-test-host");
} else {
  process.on("SIGTERM", () => {});
  require("node:fs").writeFileSync("ready", "ready");
  process.stdin.resume();
  setInterval(() => {}, 1000);
}
`,
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${directory}:${process.env.PATH ?? ""}`);
    try {
      const result = await runClaude(
        {
          cwd: directory,
          prompt: "process control test; no model is called",
          timeoutMs: 8_000,
          pollMs: 20,
          stopWhen: async () => existsSync(join(directory, "ready")),
        },
        "test-interruption",
      );
      expect(result.status).toBe("interrupted");
      expect(result.signal).toBe("SIGKILL");
      expect(result.elapsedMs).toBeLessThan(7_000);
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

const RESULT_LINE = JSON.stringify({
  type: "result",
  subtype: "success",
  result: "all done",
  usage: {},
});

describe("parseStream", () => {
  it("extracts result text and counts assistant messages", () => {
    const stream = [
      JSON.stringify({ type: "assistant", message: { role: "assistant" } }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
        },
      }),
      RESULT_LINE,
    ].join("\n");
    const parsed = parseStream(stream);
    expect(parsed.resultText).toBe("all done");
    expect(parsed.callCount).toBe(2);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("reports malformed lines as diagnostics instead of guessing", () => {
    const stream = ["not-json", RESULT_LINE].join("\n");
    const parsed = parseStream(stream);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(parsed.resultText).toBe("all done");
  });

  it("exposes structured output when present", () => {
    const stream = JSON.stringify({
      type: "result",
      structured_output: { verdict: "pass" },
    });
    const parsed = parseStream(stream);
    expect(parsed.resultText).toBe('{"verdict":"pass"}');
  });

  it("retains result error metadata without making metadata itself invalid", () => {
    const parsed = parseStream(
      JSON.stringify({
        type: "result",
        subtype: "api_error",
        is_error: true,
        errors: ["unrecognized_model"],
        api_error_status: 400,
        model: "gemini-test",
      }),
    );
    expect(parsed.resultMetadata).toEqual({
      is_error: true,
      subtype: "api_error",
      errors: ["unrecognized_model"],
      api_error_status: 400,
      model: "gemini-test",
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(classify(0, parsed, false, false)).toBe("error");
  });

  it("leaves resultText null when no result event arrived", () => {
    const parsed = parseStream(
      JSON.stringify({ type: "system", subprocess: [] }),
    );
    expect(parsed.resultText).toBeNull();
    expect(parsed.callCount).toBeNull();
  });
});

describe("classify", () => {
  it("marks a clean result event as success", () => {
    expect(classify(0, parseStream(RESULT_LINE), false, false)).toBe("success");
  });

  it("treats an explicit is_error result as error even on exit 0", () => {
    const stream = JSON.stringify({ type: "result", is_error: true });
    expect(classify(0, parseStream(stream), false, false)).toBe("error");
  });

  it("distinguishes timeout, interruption and invalid streams", () => {
    expect(classify(0, parseStream(RESULT_LINE), false, true)).toBe("timeout");
    expect(classify(0, parseStream(RESULT_LINE), true, false)).toBe(
      "interrupted",
    );
    expect(classify(0, parseStream(""), false, false)).toBe("invalid");
    expect(classify(1, parseStream(RESULT_LINE), false, false)).toBe("error");
  });
});
