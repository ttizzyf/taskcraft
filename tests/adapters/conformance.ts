import { CLAUDE_ENTRY_STREAM } from "./claude-entry-fixture.js";
// Shared conformance contract for every HostAdapter: the same suite drives
// codex and claude to prove both hosts share the contract without sharing
// implementation details. All host interaction goes through the fake host;
// no real host binary is ever executed.

import { afterAll, describe, expect, it } from "vitest";

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveTcPath } from "../../src/adapters/shared.js";
import type {
  AdapterDeps,
  CapabilityName,
  HostAdapter,
  HostRun,
} from "../../src/adapters/types.js";
import { renderNodeBrief } from "../../src/core/node-brief.js";
import type { NodeBriefInput } from "../../src/core/node-brief.js";
import type { FakeHost } from "../helpers/fake-host.js";
import {
  BREADCRUMB_LINE,
  CAPABILITY_DOCUMENT_TEXT,
  FIXED_NOW,
} from "../helpers/fake-host.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

export const CAPABILITY_NAMES: readonly CapabilityName[] = [
  "session-start",
  "structured-output",
  "run-correlation",
];

export interface FsWriteLog {
  paths: string[];
  reset(): void;
}

/** Real filesystem writes recorded while installEntry runs (via a node:fs
 * mock wired by each test file): the never-writes-outside-project guarantee
 * is asserted against actual writes, not just returned hook paths. */
export function runConformance(
  createAdapter: (deps: AdapterDeps) => HostAdapter,
  fake: FakeHost,
  fsWriteLog: FsWriteLog,
): void {
  const adapter = createAdapter(fake.deps());
  const id = adapter.id;

  describe(`conformance: ${id} capabilities`, () => {
    it("probes version and document text and reports the shared item shape", () => {
      fake.setProbeScript(id, ["--version"], { stdout: "1.2.3\n" });
      registerDocumentProbes(fake, id);

      const capabilities = adapter.capabilities();

      expect(capabilities.host).toBe(id);
      expect(capabilities.version).toBe("1.2.3");
      expect(capabilities.items.map((item) => item.name)).toEqual([
        ...CAPABILITY_NAMES,
      ]);
      expect(capabilities.items.every((item) => item.available)).toBe(true);
    });

    it("reports explicit failure reasons when the version probe fails", () => {
      fake.reset();
      fake.setProbeScript(id, ["--version"], {
        exitCode: 1,
        stderr: "not logged in",
      });

      const capabilities = adapter.capabilities();

      expect(capabilities.version).toBeNull();
      expect(capabilities.items).toHaveLength(CAPABILITY_NAMES.length);
      expect(capabilities.items.every((item) => !item.available)).toBe(true);
      expect(
        capabilities.items.every((item) =>
          item.limitation?.includes("not logged in"),
        ),
      ).toBe(true);
    });

    it("never crashes when the probe throws", () => {
      const throwing = createAdapter({
        probe: () => {
          throw new Error("probe exploded");
        },
      });

      const capabilities = throwing.capabilities();

      expect(capabilities.version).toBeNull();
      expect(capabilities.items.every((item) => !item.available)).toBe(true);
      expect(
        capabilities.items.every((item) => item.limitation !== undefined),
      ).toBe(true);
    });
  });

  describe(`conformance: ${id} installEntry`, () => {
    it("writes hook scripts and project config once and is idempotent", () => {
      const projectDir = createTemporaryDirectory();

      try {
        const first = adapter.installEntry({
          projectDir: projectDir.path,
          takeOver: "ask",
        });

        expect(first.ok).toBe(true);
        // Both wrappers land on every platform: entry.sh for POSIX hosts and
        // entry.mjs for Windows hosts, which have no bash.
        expect(first.hookPaths).toEqual([
          join(projectDir.path, ".taskcraft", "hooks", "entry.sh"),
          join(projectDir.path, ".taskcraft", "hooks", "entry.mjs"),
        ]);
        const entryContent = readFileSync(first.hookPaths[0]!, "utf8");
        const gateContent = readFileSync(first.hookPaths[1]!, "utf8");
        expect(gateContent).toContain(resolveTcPath().replaceAll("\\", "/"));
        // The Node gate passes argv as an array, not a shell string.
        expect(gateContent).toContain('"state", "--breadcrumb"');
        expect(gateContent).toContain("Taskcraft Entry context:");
        // The entry wrapper delegates to the public CLI next to the adapter
        // module (resolveTcPath: dist/cli.js from the built layout, src/cli.js
        // under tests). The built-artifact layout is pinned by the CLI
        // integration test that spawns dist/cli.js.
        expect(entryContent).toContain(resolveTcPath());
        expect(entryContent).toContain("state --breadcrumb");
        expect(entryContent).toContain('cd "$(dirname "$0")/../.."');

        const second = adapter.installEntry({
          projectDir: projectDir.path,
          takeOver: "ask",
        });

        // Existing project config is left untouched and the second install
        // FAILS explicitly (ok=false): an unregistered project must never be
        // reported as a partial success.
        expect(second.ok).toBe(false);
        expect(second.hookPaths).toEqual(first.hookPaths);
        expect(second.limitation).toContain("config exists");
        expect(readFileSync(first.hookPaths[0]!, "utf8")).toBe(entryContent);
      } finally {
        projectDir.cleanup();
      }
    });

    it("never writes outside the project directory", () => {
      const projectDir = createTemporaryDirectory();

      try {
        fsWriteLog.reset();
        const result = adapter.installEntry({
          projectDir: projectDir.path,
          takeOver: "off",
        });

        expect(result.ok).toBe(true);
        // Intercepted real writes (not just the returned hook paths, which
        // the implementation constructs itself): every write must land inside
        // the project directory, so global host config can never be touched.
        expect(fsWriteLog.paths.length).toBeGreaterThan(0);
        expect(
          fsWriteLog.paths.every((path) => path.startsWith(projectDir.path)),
        ).toBe(true);
      } finally {
        projectDir.cleanup();
      }
    });
  });

  describe(`conformance: ${id} testEntryHook`, () => {
    const projectDir = createTemporaryDirectory();
    const entryScript = join(
      projectDir.path,
      ".taskcraft",
      "hooks",
      "entry.sh",
    );
    const input = { projectDir: projectDir.path, entryScript };
    // The codex trust gate must not depend on the developer's real
    // ~/.codex/config.toml: wire a user config that trusts the project.
    const userConfigPath = join(projectDir.path, "codex-user-config.toml");
    writeFileSync(
      userConfigPath,
      `[projects."${projectDir.path}"]\ntrust_level = "trusted"\n`,
      "utf8",
    );
    const testEntryHookAdapter = createAdapter({
      ...fake.deps(),
      userConfigPath,
    });

    afterAll(() => {
      projectDir.cleanup();
    });

    /** Scripts the fake environment for a passing Entry Hook field test. */
    function scriptPassingChain(): void {
      if (id === "codex") {
        fake.setProbeScript("codex", ["features", "list"], {
          stdout: "hooks stable true\n",
        });
      }
      fake.setSpawnScript(id, {
        stdout:
          id === "claude"
            ? CLAUDE_ENTRY_STREAM
            : `${BREADCRUMB_LINE}\nagent: TC_FIRST\n`,
      });
    }

    it("observes Entry injection with the default 60s timeout", async () => {
      fake.reset();
      scriptPassingChain();

      const result = await testEntryHookAdapter.testEntryHook(input);

      expect(result.ok).toBe(true);
      expect(result.entryInjected).toBe(true);
      expect(result.testedAt).toBe(FIXED_NOW);
      const hostCall = fake.calls.find(
        (call) => call.kind === "spawn" && call.command === id,
      );
      expect(hostCall?.timeoutMs).toBe(60_000);
      expect(hostCall?.cwd).toBe(projectDir.path);
      expect(hostCall?.args.at(-1)).toBe(
        id === "codex"
          ? "If your injected context contains tc-breadcrumb/v1, reply exactly tc-breadcrumb/v1. Otherwise reply exactly NO_BREADCRUMB."
          : "Reply exactly TC_FIRST.",
      );
      if (id === "codex") {
        expect(hostCall?.args).not.toContain("--dangerously-bypass-hook-trust");
      }
    });

    it("fails explicitly when the host output lacks the breadcrumb", async () => {
      fake.reset();
      scriptPassingChain();
      fake.setSpawnScript(id, { stdout: "agent: TC_FIRST\n" });

      const result = await testEntryHookAdapter.testEntryHook(input);

      expect(result.ok).toBe(false);
      expect(result.entryInjected).toBe(false);
      expect(result.failure).toContain("tc-breadcrumb/v1");
    });

    it("fails explicitly on the hard timeout", async () => {
      fake.reset();
      scriptPassingChain();
      fake.setSpawnScript(id, { timedOut: true });

      const result = await testEntryHookAdapter.testEntryHook(input);

      expect(result.ok).toBe(false);
      expect(result.failure).toContain("timed out");
    });

    it("fails explicitly on a non-zero host exit", async () => {
      fake.reset();
      scriptPassingChain();
      fake.setSpawnScript(id, { exitCode: 1, stderr: "boom" });

      const result = await testEntryHookAdapter.testEntryHook(input);

      expect(result.ok).toBe(false);
      expect(result.failure).toContain("exit");
      expect(result.failure).toContain("boom");
    });

    it("fails explicitly when the host-specific gate is not satisfied", async () => {
      fake.reset();

      if (id === "codex") {
        // The codex adapter wraps its own gate; a features list without hooks
        // makes it fail before any spawn.
        fake.setProbeScript("codex", ["features", "list"], {
          stdout: "no capabilities mentioned\n",
        });
      }

      const result = await testEntryHookAdapter.testEntryHook({
        ...input,
        gate: () => "codex hooks feature gate: not enabled",
      });

      expect(result.ok).toBe(false);
      expect(result.failure).toContain("feature gate");
    });

    it("respects a custom timeout", async () => {
      fake.reset();
      scriptPassingChain();
      fake.setSpawnScript(id, { timedOut: true });

      const result = await testEntryHookAdapter.testEntryHook({
        ...input,
        timeoutMs: 5_000,
      });

      expect(result.ok).toBe(false);
      expect(result.failure).toContain("5000ms");
      const hostCall = fake.calls.find(
        (call) => call.kind === "spawn" && call.command === id,
      );
      expect(hostCall?.timeoutMs).toBe(5_000);
    });
  });

  describe(`conformance: ${id} renderNodeBrief`, () => {
    it("renders through the shared core source and carries host data", () => {
      const input: NodeBriefInput = {
        host: id,
        hostVersion: "1.2.3",
        hostCapabilities: [{ name: "session-start", available: true }],
        brief: {
          taskId: "T-1",
          taskTitle: "Sample",
          taskRevision: 2,
          lifecycleRevision: 1,
          nodeId: "execute-1",
          nodeKind: "execute",
          attemptId: "attempt-1",
          objective: "Do the thing",
          procedureRef: "l1:execute",
          obligations: [
            { id: "outcome", duty: "required", title: "Outcome produced" },
          ],
          specs: [
            {
              id: "engineering.store",
              kind: "engineering",
              duty: "required",
              path: "docs/store.md",
              digest: "a".repeat(64),
              drift: { status: "current", reasons: [] },
            },
          ],
          reviewContext: null,
          resultSchemaJson: '{"type":"object"}',
          nextCommand: "tc run complete T-1",
        },
      };

      const rendered = adapter.renderNodeBrief(input);

      expect(rendered).toEqual(renderNodeBrief(input));
      expect(rendered.text).toContain(`Host: ${id}`);
      expect(rendered.text).toContain("Objective: Do the thing");
      expect(rendered.text).toContain("Outcome produced");
      expect(rendered.text).toContain('"type":"object"');
      expect(rendered.text).toContain("tc run complete T-1");
      expect(rendered.text).toContain("session-start: available");
    });
  });

  describe(`conformance: ${id} observe`, () => {
    it("maps a stored run without writing the Task Store", () => {
      const run: HostRun = {
        id: "ar-1",
        taskId: "T-1",
        nodeAttemptId: "att-T-1-execute-1-1",
        host: id,
        hostRunId: "run-1",
        hostSessionId: "sess-1",
        observationStatus: "running",
        lastSeenAt: null,
        finishReason: null,
        observationJson: '{"tokens":12}',
      };

      expect(adapter.observe!(run)).toEqual({
        status: "running",
        lastSeenAt: FIXED_NOW,
      });
    });
  });
}

function registerDocumentProbes(fake: FakeHost, id: string): void {
  if (id === "codex") {
    fake.setProbeScript("codex", ["features", "list"], {
      stdout: CAPABILITY_DOCUMENT_TEXT,
    });
    fake.setProbeScript("codex", ["exec", "--help"], {
      stdout: CAPABILITY_DOCUMENT_TEXT,
    });
    return;
  }

  fake.setProbeScript("claude", ["--help"], {
    stdout: CAPABILITY_DOCUMENT_TEXT,
  });
}
