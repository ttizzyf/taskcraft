// Shared conformance contract for every HostAdapter: the same suite drives
// codex and claude to prove both hosts share the contract without sharing
// implementation details. All host interaction goes through the fake host;
// no real host binary is ever executed.

import { afterAll, describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  ENTRY_MARKER,
  resolveTcPath,
  STOP_ALLOW_MARKER,
  STOP_BLOCK_MARKER,
} from "../../src/adapters/shared.js";
import type {
  AdapterDeps,
  CapabilityName,
  HostAdapter,
  HostRun,
} from "../../src/adapters/types.js";
import { renderNodeBrief } from "../../src/core/node-brief.js";
import type { NodeBriefInput } from "../../src/core/node-brief.js";
import { project } from "../../src/core/projector.js";
import { getAgentRuns } from "../../src/store/query.js";
import type { FakeHost } from "../helpers/fake-host.js";
import { CAPABILITY_DOCUMENT_TEXT, FIXED_NOW } from "../helpers/fake-host.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";
import { createMigratedDatabase, insertL1Fixture } from "../store/helpers.js";

export const CAPABILITY_NAMES: readonly CapabilityName[] = [
  "session-start",
  "stop",
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
        expect(first.hookPaths).toHaveLength(2);
        expect(first.hookPaths[0]).toBe(
          join(projectDir.path, ".taskcraft", "hooks", "entry.sh"),
        );
        expect(first.hookPaths[1]).toBe(
          join(projectDir.path, ".taskcraft", "hooks", "stop.sh"),
        );

        const entryContent = readFileSync(first.hookPaths[0]!, "utf8");
        // The wrapper invokes the gate entry point next to the tc CLI entry
        // (one parent hop from the adapter module). The dist build lands on
        // dist/hooks/entry.js; the built-artifact layout is pinned by the
        // CLI integration test that spawns dist/cli.js.
        expect(entryContent).toContain(
          join(dirname(resolveTcPath()), "hooks", "entry.js"),
        );
        expect(entryContent).toContain("config.json");

        const second = adapter.installEntry({
          projectDir: projectDir.path,
          takeOver: "ask",
        });

        expect(second.ok).toBe(true);
        expect(second.hookPaths).toEqual(first.hookPaths);
        // Existing project config is left untouched; the partial success is
        // reported explicitly instead of silently claiming registration.
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

  describe(`conformance: ${id} testHook`, () => {
    const projectDir = createTemporaryDirectory();

    afterAll(() => {
      projectDir.cleanup();
    });

    it("observes entry injection and stop enforcement with default 60s timeout", () => {
      fake.reset();
      fake.setSpawnScript(id, {
        stdout: `${ENTRY_MARKER}\nagent: TC_FIRST\n${STOP_BLOCK_MARKER}\n`,
      });

      const result = adapter.testHook({ projectDir: projectDir.path });

      expect(result.ok).toBe(true);
      expect(result.entryInjected).toBe(true);
      expect(result.stopEnforced).toBe(true);
      expect(result.testedAt).toBe(FIXED_NOW);
      const spawnCall = fake.calls.find((call) => call.kind === "spawn");
      expect(spawnCall?.timeoutMs).toBe(60_000);
      expect(spawnCall?.cwd).toContain(".taskcraft");
      expect(spawnCall?.args.at(-1)).toBe("Reply exactly TC_FIRST.");
    });

    it("accepts an allow decision without stop enforcement", () => {
      fake.reset();
      fake.setSpawnScript(id, {
        stdout: `${ENTRY_MARKER}\n${STOP_ALLOW_MARKER}\n`,
      });

      const result = adapter.testHook({ projectDir: projectDir.path });

      expect(result.ok).toBe(true);
      expect(result.entryInjected).toBe(true);
      expect(result.stopEnforced).toBe(false);
    });

    it("fails explicitly on malformed output without the entry marker", () => {
      fake.reset();
      fake.setSpawnScript(id, { stdout: "agent: TC_FIRST\n" });

      const result = adapter.testHook({ projectDir: projectDir.path });

      expect(result.ok).toBe(false);
      expect(result.entryInjected).toBe(false);
      expect(result.failure).toContain(ENTRY_MARKER);
    });

    it("fails explicitly on the hard timeout", () => {
      fake.reset();
      fake.setSpawnScript(id, { timedOut: true });

      const result = adapter.testHook({ projectDir: projectDir.path });

      expect(result.ok).toBe(false);
      expect(result.failure).toContain("timed out");
    });

    it("fails explicitly on a non-zero host exit", () => {
      fake.reset();
      fake.setSpawnScript(id, { exitCode: 1, stderr: "boom" });

      const result = adapter.testHook({ projectDir: projectDir.path });

      expect(result.ok).toBe(false);
      expect(result.failure).toContain("exit");
      expect(result.failure).toContain("boom");
    });

    it("respects a custom timeout", () => {
      fake.reset();
      fake.setSpawnScript(id, { timedOut: true });

      const result = adapter.testHook({
        projectDir: projectDir.path,
        timeoutMs: 5_000,
      });

      expect(result.ok).toBe(false);
      expect(result.failure).toContain("5000ms");
      const spawnCall = fake.calls.find((call) => call.kind === "spawn");
      expect(spawnCall?.timeoutMs).toBe(5_000);
    });
  });

  describe(`conformance: ${id} renderNodeBrief`, () => {
    it("renders through the shared core source and carries host data", () => {
      const input: NodeBriefInput = {
        host: id,
        hostVersion: "1.2.3",
        hostCapabilities: [
          { name: "session-start", available: true },
          { name: "stop", available: false, limitation: "probe failed" },
        ],
        brief: {
          taskId: "T-1",
          taskTitle: "Sample",
          nodeId: "execute-1",
          nodeKind: "execute",
          attemptId: "attempt-1",
          objective: "Do the thing",
          procedureRef: "l1:execute",
          obligations: [
            { id: "outcome", duty: "required", title: "Outcome produced" },
          ],
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
      expect(rendered.text).toContain("stop: unavailable (probe failed)");
    });
  });

  describe(`conformance: ${id} attachObservation`, () => {
    it("writes agent_runs without driving task status", () => {
      const database = createMigratedDatabase();

      try {
        insertL1Fixture(database);
        const statusBefore = project(database, "task-l1").status;
        const wired = createAdapter({ ...fake.deps(), database });

        const run: HostRun = wired.attachObservation!({
          taskId: "task-l1",
          nodeAttemptId: "attempt-1",
          host: id,
          hostRunId: "run-1",
          hostSessionId: "sess-1",
          observationStatus: "running",
          observation: { tokens: 12 },
        });

        expect(run.id).toBe("ar-1");
        expect(run.host).toBe(id);
        expect(run.hostRunId).toBe("run-1");
        expect(run.finishReason).toBeNull();

        const rows = getAgentRuns(database, "task-l1");
        expect(rows).toHaveLength(1);
        expect(rows[0]!.hostSessionId).toBe("sess-1");
        expect(rows[0]!.observationStatus).toBe("running");
        expect(JSON.parse(rows[0]!.observationJson)).toEqual({ tokens: 12 });

        const observation = wired.observe!(run);
        expect(observation.status).toBe("running");
        expect(observation.lastSeenAt).toBe(FIXED_NOW);

        expect(project(database, "task-l1").status).toBe(statusBefore);
      } finally {
        database.close();
      }
    });

    it("fails explicitly when no database is wired", () => {
      expect(() =>
        adapter.attachObservation?.({
          taskId: "task-l1",
          nodeAttemptId: "attempt-1",
          host: id,
        }),
      ).toThrow(/database/);
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
