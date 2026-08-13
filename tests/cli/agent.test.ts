// tc agent: capabilities probes both local hosts (read-only, never crashes)
// and reports explicit limitation reasons; test-hook rejects an unknown
// agent before any probe and fails explicitly on a non-initialized project.
// The runAgentTestHook chain scenarios live in agent-hook-test.test.ts; the
// CLI here never executes a real host binary.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
import { parseJson, runCli, withTemporaryDirectory } from "./helpers.js";

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
    expect(text).toContain(
      "hook test: never recorded (run: tc agent test-hook --agent codex)",
    );
  });

  it("renders the persisted hook test row of a host", () => {
    const text = renderCapabilities([
      {
        ...capabilities,
        hookTest: {
          testedAt: "2026-08-13T00:00:00.000Z",
          version: "2.1.220",
          ok: true,
          enforced: true,
        },
      },
      {
        ...capabilities,
        hookTest: {
          testedAt: "2026-08-13T00:00:00.000Z",
          version: null,
          ok: false,
          enforced: false,
          failure: "stop block missing",
        },
      },
    ]);

    expect(text).toContain(
      "hook test: tested 2026-08-13T00:00:00.000Z, version 2.1.220, enforced, ok",
    );
    expect(text).toContain("failed: stop block missing");
    expect(text).toContain("not enforced");
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

  it("capabilities reads the latest hook test row from config.hookTests", () => {
    withTemporaryDirectory((cwd) => {
      mkdirSync(join(cwd, ".taskcraft"), { recursive: true });
      writeFileSync(
        join(cwd, ".taskcraft", "config.json"),
        `${JSON.stringify(
          {
            takeOver: "ask",
            hookTests: {
              claude: {
                testedAt: "2026-08-13T00:00:00.000Z",
                version: "2.1.220",
                ok: true,
                enforced: true,
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const text = runCli(["agent", "capabilities"], cwd);
      expect(text.status).toBe(0);
      expect(text.stdout).toContain(
        "hook test: tested 2026-08-13T00:00:00.000Z, version 2.1.220, enforced, ok",
      );

      const json = parseJson<{
        ok: boolean;
        data: {
          hosts: Array<{
            host: string;
            hookTest?: { testedAt: string; ok: boolean };
          }>;
        };
      }>(runCli(["agent", "capabilities", "--json"], cwd));
      const claude = json.data.hosts.find((host) => host.host === "claude");
      const codex = json.data.hosts.find((host) => host.host === "codex");

      expect(claude?.hookTest).toMatchObject({
        testedAt: "2026-08-13T00:00:00.000Z",
        ok: true,
      });
      expect(codex?.hookTest).toBeUndefined();
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
