// tc agent: capabilities probes both local hosts (read-only, never crashes)
// and reports explicit limitation reasons; test-hook runs against a fake host
// for the success/enforced, advisory and failure paths and maps failures to
// the TC_ADAPTER_* diagnostics. The CLI never executes a real host binary in
// tests (unknown --agent is rejected before any probe or spawn).

import { describe, expect, it } from "vitest";

import { createCodexAdapter } from "../../src/adapters/codex.js";
import { createClaudeAdapter } from "../../src/adapters/claude.js";
import { ENTRY_MARKER, STOP_BLOCK_MARKER } from "../../src/adapters/shared.js";
import type {
  AdapterCapabilities,
  HostAdapter,
} from "../../src/adapters/types.js";
import { ERROR_CODES, TaskcraftError } from "../../src/core/errors.js";
import {
  pickDefaultAdapter,
  renderCapabilities,
  resolveAgentAdapter,
  runAgentTestHook,
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

describe("runAgentTestHook", () => {
  it("reports ok with stop enforced when both markers appear", () => {
    const fake = createFakeHost();
    fake.setSpawnScript("codex", {
      stdout: `${ENTRY_MARKER}\nagent: TC_FIRST\n${STOP_BLOCK_MARKER}\n`,
    });

    const summary = runAgentTestHook(createCodexAdapter(fake.deps()));

    expect(summary.ok).toBe(true);
    expect(summary.host).toBe("codex");
    expect(summary.entryInjected).toBe(true);
    expect(summary.stopEnforced).toBe(true);
    expect(summary.mode).toBe("enforced");
    expect(summary.testedAt).toBe("2026-08-12T00:00:00.000Z");
  });

  it("reports advisory when the stop hook did not enforce", () => {
    const fake = createFakeHost();
    fake.setSpawnScript("codex", { stdout: `${ENTRY_MARKER}\n` });

    const summary = runAgentTestHook(createCodexAdapter(fake.deps()));

    expect(summary.ok).toBe(true);
    expect(summary.entryInjected).toBe(true);
    expect(summary.stopEnforced).toBe(false);
    expect(summary.mode).toBe("advisory");
  });

  it("fails with TC_ADAPTER_HOOK_TEST_FAILED when entry never injected", () => {
    const fake = createFakeHost();
    fake.setSpawnScript("codex", { stdout: "agent: TC_FIRST\n" });

    try {
      runAgentTestHook(createCodexAdapter(fake.deps()));
      throw new Error("expected TC_ADAPTER_HOOK_TEST_FAILED");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskcraftError);
      const taskcraftError = error as TaskcraftError;
      expect(taskcraftError.code).toBe(ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED);
      expect(taskcraftError.problem).toContain(ENTRY_MARKER);
      expect(taskcraftError.impact).toBeTruthy();
      expect(taskcraftError.remediation).toContain("tc agent test-hook");
    }
  });

  it("fails with TC_ADAPTER_HOOK_TEST_FAILED on the hard timeout", () => {
    const fake = createFakeHost();
    fake.setSpawnScript("codex", { timedOut: true });

    try {
      runAgentTestHook(createCodexAdapter(fake.deps()));
      throw new Error("expected TC_ADAPTER_HOOK_TEST_FAILED");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskcraftError);
      expect((error as TaskcraftError).code).toBe(
        ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED,
      );
      expect((error as TaskcraftError).problem).toContain("timed out");
    }
  });

  it("fails with TC_ADAPTER_HOOK_TEST_FAILED on a non-zero host exit", () => {
    const fake = createFakeHost();
    fake.setSpawnScript("codex", { exitCode: 1, stderr: "boom" });

    try {
      runAgentTestHook(createCodexAdapter(fake.deps()));
      throw new Error("expected TC_ADAPTER_HOOK_TEST_FAILED");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskcraftError);
      expect((error as TaskcraftError).code).toBe(
        ERROR_CODES.TC_ADAPTER_HOOK_TEST_FAILED,
      );
      expect((error as TaskcraftError).problem).toContain("boom");
    }
  });

  it("fails with TC_ADAPTER_HOOK_INSTALL_FAILED when installation fails", () => {
    const failing: HostAdapter = {
      id: "codex",
      capabilities: () => ({ host: "codex", version: null, items: [] }),
      installEntry: () => ({
        ok: false,
        hookPaths: [],
        limitation: "permission denied",
      }),
      testHook: () => {
        throw new Error("unreachable");
      },
      renderNodeBrief: () => {
        throw new Error("unreachable");
      },
    };

    try {
      runAgentTestHook(failing);
      throw new Error("expected TC_ADAPTER_HOOK_INSTALL_FAILED");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskcraftError);
      expect((error as TaskcraftError).code).toBe(
        ERROR_CODES.TC_ADAPTER_HOOK_INSTALL_FAILED,
      );
      expect((error as TaskcraftError).problem).toContain("permission denied");
    }
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
});
