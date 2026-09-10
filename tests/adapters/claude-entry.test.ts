import { describe, expect, it } from "vitest";
import { createClaudeAdapter } from "../../src/adapters/claude.js";
import { createFakeHost } from "../helpers/fake-host.js";
import {
  CLAUDE_HOOK_EVENT,
  CLAUDE_RESULT_EVENT,
} from "./claude-entry-fixture.js";

describe("Claude Entry event evidence", () => {
  const cases: Array<[string, unknown[], string]> = [
    [
      "model parrots valid breadcrumb",
      [
        { type: "assistant", message: { content: CLAUDE_HOOK_EVENT.stdout } },
        CLAUDE_RESULT_EVENT,
      ],
      "missing valid",
    ],
    [
      "failed Hook carries breadcrumb",
      [
        { ...CLAUDE_HOOK_EVENT, exit_code: 1, outcome: "error" },
        CLAUDE_RESULT_EVENT,
      ],
      "Hook failed",
    ],
    [
      "different Hook",
      [{ ...CLAUDE_HOOK_EVENT, hook_event: "Stop" }, CLAUDE_RESULT_EVENT],
      "missing valid",
    ],
    [
      "invalid breadcrumb shape",
      [
        {
          ...CLAUDE_HOOK_EVENT,
          stdout: '{"schemaVersion":"tc-breadcrumb/v1"}',
        },
        CLAUDE_RESULT_EVENT,
      ],
      "missing valid",
    ],
    [
      "model terminal error",
      [CLAUDE_HOOK_EVENT, { ...CLAUDE_RESULT_EVENT, is_error: true }],
      "model result",
    ],
    [
      "error subtype",
      [
        CLAUDE_HOOK_EVENT,
        { ...CLAUDE_RESULT_EVENT, subtype: "error_max_turns" },
      ],
      "model result",
    ],
    ["no model terminal event", [CLAUDE_HOOK_EVENT], "missing successful"],
    [
      "later failed Hook",
      [
        CLAUDE_HOOK_EVENT,
        { ...CLAUDE_HOOK_EVENT, outcome: "error" },
        CLAUDE_RESULT_EVENT,
      ],
      "Hook failed",
    ],
  ];
  it.each(cases)("rejects %s", (_name, events, failure) => {
    const fake = createFakeHost();
    fake.setSpawnScript("claude", {
      stdout: events.map((e) => JSON.stringify(e)).join("\n"),
    });
    const result = createClaudeAdapter(fake.deps()).testEntryHook({
      projectDir: "/tmp",
      entryScript: "/tmp/entry.sh",
    });
    expect(result.ok).toBe(false);
    expect(result.entryInjected).toBe(false);
    expect(result.failure).toContain(failure);
  });
  it("rejects truncated stream even after successful evidence", () => {
    const fake = createFakeHost();
    fake.setSpawnScript("claude", {
      stdout:
        [CLAUDE_HOOK_EVENT, CLAUDE_RESULT_EVENT]
          .map((e) => JSON.stringify(e))
          .join("\n") + '\n{"type":',
    });
    expect(
      createClaudeAdapter(fake.deps()).testEntryHook({
        projectDir: "/tmp",
        entryScript: "/tmp/entry.sh",
      }).failure,
    ).toContain("malformed");
  });
});
