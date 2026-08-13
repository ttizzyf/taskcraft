// tc agent: capabilities probes both local hosts (read-only, never crashes)
// and reports explicit limitation reasons; test-hook rejects an unknown
// agent before any probe and fails explicitly on a non-initialized project.
// The runAgentTestHook chain scenarios live in agent-hook-test.test.ts; the
// CLI here never executes a real host binary.

import { describe, expect, it } from "vitest";

import { createCodexAdapter } from "../../src/adapters/codex.js";
import { createClaudeAdapter } from "../../src/adapters/claude.js";
import type { AdapterCapabilities } from "../../src/adapters/types.js";
import { ERROR_CODES, TaskcraftError } from "../../src/core/errors.js";
import {
  pickDefaultAdapter,
  renderCapabilities,
  resolveAgentAdapter,
} from "../../src/commands/agent.js";
import { createFakeHost } from "../helpers/fake-host.js";
import { runCli, withTemporaryDirectory } from "./helpers.js";

describe("resolveAgentAdapter", () => {
  it("resolves codex and claude", () => {
    expect(resolveAgentAdapter("codex").id).toBe("codex");
    expect(resolveAgentAdapter("claude").id).toBe("claude");
  });

  it("rejects unknown agents with TC_ADAPTER_UNSUPPORTED", () => {
    try {
      resolveAgentAdapter("gemini");
      throw new Error("expected TC_ADAPTER_UNSUPPORTED");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskcraftError);
      expect((error as TaskcraftError).code).toBe(
        ERROR_CODES.TC_ADAPTER_UNSUPPORTED,
      );
      expect((error as TaskcraftError).remediation).toContain(
        "tc agent test-hook --agent codex|claude",
      );
    }
  });
});

describe("pickDefaultAdapter", () => {
  it("picks the first host whose version probe succeeded", () => {
    const fake = createFakeHost();
    fake.setProbeScript("codex", ["--version"], { stdout: "1.2.3\n" });

    const picked = pickDefaultAdapter([
      createCodexAdapter(fake.deps()),
      createClaudeAdapter(fake.deps()),
    ]);

    expect(picked.id).toBe("codex");
  });

  it("fails explicitly when no supported host is installed", () => {
    const fake = createFakeHost();

    try {
      pickDefaultAdapter([
        createCodexAdapter(fake.deps()),
        createClaudeAdapter(fake.deps()),
      ]);
      throw new Error("expected TC_ADAPTER_UNSUPPORTED");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskcraftError);
      expect((error as TaskcraftError).code).toBe(
        ERROR_CODES.TC_ADAPTER_UNSUPPORTED,
      );
    }
  });
});

describe("renderCapabilities", () => {
  const capabilities: AdapterCapabilities = {
    host: "codex",
    version: "1.2.3",
    items: [
      { name: "session-start", available: true },
      { name: "stop", available: false, limitation: "probe failed" },
      {
        name: "structured-output",
        available: true,
        limitation: "limited note",
      },
    ],
  };

  it("renders host, version and each item with its availability", () => {
    const text = renderCapabilities([capabilities]);

    expect(text).toContain("codex 1.2.3");
    expect(text).toContain("session-start: available");
    expect(text).toContain("stop: unavailable: probe failed");
    expect(text).toContain("structured-output: limited: limited note");
  });
});

describe("tc agent (CLI smoke)", () => {
  it("capabilities exits 0 and lists both hosts", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["agent", "capabilities"], cwd);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Host capabilities");
      expect(result.stdout).toContain("codex");
      expect(result.stdout).toContain("claude");
      expect(result.stdout).toContain("session-start");
    });
  });

  it("capabilities --json returns the hosts envelope", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["agent", "capabilities", "--json"], cwd);

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        ok: boolean;
        data: { hosts: Array<{ host: string }> };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.data.hosts.map((host) => host.host)).toEqual([
        "codex",
        "claude",
      ]);
    });
  });

  it("test-hook rejects an unknown agent before any spawn", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["agent", "test-hook", "--agent", "gemini"], cwd);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_ADAPTER_UNSUPPORTED");
      expect(result.stderr).toContain(
        "tc agent test-hook --agent codex|claude",
      );
    });
  });

  it("test-hook fails explicitly when the project is not initialized", () => {
    withTemporaryDirectory((cwd) => {
      const result = runCli(["agent", "test-hook", "--agent", "claude"], cwd);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TC_ADAPTER_HOOK_TEST_FAILED");
      expect(result.stderr).toContain("config.json");
    });
  });
});
