import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/store/database.js";
import {
  getLifecycleSpecBindings,
  getSpecSedimentationResults,
  getTask,
} from "../../src/store/query.js";
import type { SpecSedimentationRow } from "../../src/store/query.js";
import { parseJson, runCli, withInitializedDirectory } from "./helpers.js";

interface SedimentData {
  taskRevision: number;
  specIds: string[];
  inserted: boolean;
}

interface CommandEnvelope<T> {
  ok: boolean;
  data: T;
}

/** Writes one Spec body and registers it in the project Registry. */
function registerSpec(
  cwd: string,
  id: string,
  name: string,
  body = `# ${name}\n\nRule body.\n`,
): void {
  const relativePath = `.taskcraft/spec/engineering/${name}.md`;
  const absolutePath = join(cwd, relativePath);
  mkdirSync(join(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, body, "utf8");

  const registryPath = join(cwd, ".taskcraft", "spec", "index.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
    schemaVersion: string;
    specs: unknown[];
  };
  registry.specs.push({
    id,
    kind: "engineering",
    path: relativePath,
    summary: `${name} rule`,
    appliesTo: ["src/**"],
    status: "active",
  });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf8");
}

function readRegistryBytes(cwd: string): string {
  return readFileSync(join(cwd, ".taskcraft", "spec", "index.json"), "utf8");
}

/** Drives one L1 task to `done` through the public CLI only. */
function createDoneTask(cwd: string): void {
  const created = runCli(
    [
      "task",
      "new",
      "--title",
      "Sedimentation subject",
      "--level",
      "1",
      "--reason",
      "isolated CLI fixture",
    ],
    cwd,
  );
  expect(created.status).toBe(0);

  expect(runCli(["run", "T-1"], cwd).status).toBe(0);

  const completed = runCli(
    [
      "run",
      "complete",
      "T-1",
      "--result",
      JSON.stringify({
        summary: "Delivered the fixture work",
        evidence: [
          {
            type: "validation",
            reference: "ref://fixture",
            summary: "Fixture validation recorded",
          },
        ],
        record: {
          summary: "Closed the fixture task",
          specImpact: {
            outcome: "none",
            reason: "The fixture produced no reusable rule",
          },
        },
      }),
    ],
    cwd,
  );
  expect(completed.status).toBe(0);
  expect(completed.stdout).toContain("Status: done");
}

function sediment(
  cwd: string,
  specIds: readonly string[],
  extra: readonly string[] = [],
): ReturnType<typeof runCli> {
  return runCli(
    [
      "task",
      "spec",
      "sediment",
      "T-1",
      "--reason",
      "capture what this task learned",
      ...specIds.flatMap((specId) => ["--spec", specId]),
      ...extra,
    ],
    cwd,
  );
}

function readSedimentations(cwd: string): SpecSedimentationRow[] {
  const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
  try {
    return getSpecSedimentationResults(database, "T-1");
  } finally {
    database.close();
  }
}

function readRevision(cwd: string): number {
  const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
  try {
    return getTask(database, "T-1")!.revision;
  } finally {
    database.close();
  }
}

describe("tc task spec sediment", () => {
  it("rejects a task that has not reached done and writes no fact", () => {
    withInitializedDirectory((cwd) => {
      registerSpec(cwd, "engineering.probe", "probe");
      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "Still queued",
            "--level",
            "1",
            "--reason",
            "sedimentation gating fixture",
          ],
          cwd,
        ).status,
      ).toBe(0);

      const revisionBefore = readRevision(cwd);

      const rejected = sediment(cwd, ["engineering.probe"]);
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("TC_SPEC_SEDIMENTATION_INVALID");

      expect(readSedimentations(cwd)).toEqual([]);
      expect(readRevision(cwd)).toBe(revisionBefore);
    });
  });

  it("rejects an unknown task with a stable error", () => {
    withInitializedDirectory((cwd) => {
      registerSpec(cwd, "engineering.probe", "probe");

      const rejected = runCli(
        [
          "task",
          "spec",
          "sediment",
          "T-404",
          "--reason",
          "unknown task",
          "--spec",
          "engineering.probe",
        ],
        cwd,
      );

      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("TC_TASK_NOT_FOUND");
    });
  });

  it("records one fact for a done task and leaves the task done", () => {
    withInitializedDirectory((cwd) => {
      registerSpec(cwd, "engineering.probe", "probe");
      createDoneTask(cwd);

      const recorded = sediment(cwd, ["engineering.probe"]);
      expect(recorded.status).toBe(0);
      expect(recorded.stdout).toContain("Status: done");
      expect(recorded.stdout).toContain("Specs: engineering.probe");
      expect(recorded.stdout).toContain("Recorded: yes");

      const rows = readSedimentations(cwd);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.specIdsJson).toBe(JSON.stringify(["engineering.probe"]));
      expect(rows[0]!.reason).toBe("capture what this task learned");

      // The fact is an output of a done task, never a new obligation: the task
      // stays done and the store stays healthy.
      expect(runCli(["task", "list"], cwd).stdout).toContain("done");
      expect(runCli(["doctor"], cwd).status).toBe(0);
    });
  });

  it("replays an identical Spec list as a no-op", () => {
    withInitializedDirectory((cwd) => {
      registerSpec(cwd, "engineering.alpha", "alpha");
      registerSpec(cwd, "engineering.beta", "beta");
      createDoneTask(cwd);

      const first = parseJson<CommandEnvelope<SedimentData>>(
        sediment(cwd, ["engineering.alpha", "engineering.beta"], ["--json"]),
      );
      expect(first.ok).toBe(true);
      expect(first.data.inserted).toBe(true);

      // A different order is the same list.
      const replay = parseJson<CommandEnvelope<SedimentData>>(
        sediment(cwd, ["engineering.beta", "engineering.alpha"], ["--json"]),
      );
      expect(replay.data.inserted).toBe(false);
      expect(replay.data.specIds).toEqual(first.data.specIds);
      expect(replay.data.taskRevision).toBe(first.data.taskRevision);

      expect(readSedimentations(cwd)).toHaveLength(1);
      expect(readRevision(cwd)).toBe(first.data.taskRevision);
    });
  });

  it("appends a second fact when the Spec list differs", () => {
    withInitializedDirectory((cwd) => {
      registerSpec(cwd, "engineering.alpha", "alpha");
      registerSpec(cwd, "engineering.beta", "beta");
      createDoneTask(cwd);

      expect(sediment(cwd, ["engineering.alpha"]).status).toBe(0);
      expect(
        sediment(cwd, ["engineering.alpha", "engineering.beta"]).status,
      ).toBe(0);

      expect(readSedimentations(cwd)).toHaveLength(2);
    });
  });

  it("rejects a Spec id that is not registered without writing a fact", () => {
    withInitializedDirectory((cwd) => {
      createDoneTask(cwd);

      const rejected = sediment(cwd, ["engineering.missing"]);
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("TC_SPEC_SEDIMENTATION_INVALID");

      expect(readSedimentations(cwd)).toEqual([]);
    });
  });

  it("rejects a stale expected revision without writing a fact", () => {
    withInitializedDirectory((cwd) => {
      registerSpec(cwd, "engineering.probe", "probe");
      createDoneTask(cwd);

      const current = readRevision(cwd);
      const rejected = sediment(
        cwd,
        ["engineering.probe"],
        ["--expected-revision", String(current + 5)],
      );
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("TC_REVISION_CONFLICT");

      expect(readSedimentations(cwd)).toEqual([]);
      expect(readRevision(cwd)).toBe(current);
    });
  });

  it("renders the same fact in text and JSON mode", () => {
    withInitializedDirectory((cwd) => {
      registerSpec(cwd, "engineering.probe", "probe");
      createDoneTask(cwd);

      const json = parseJson<CommandEnvelope<SedimentData>>(
        sediment(cwd, ["engineering.probe"], ["--json"]),
      );

      // A replay returns the stored fact, so the plain rendering must agree
      // with the JSON payload instead of inventing a second shape.
      const text = sediment(cwd, ["engineering.probe"]);
      expect(text.status).toBe(0);
      expect(text.stdout).toContain(`Specs: ${json.data.specIds.join(", ")}`);
      expect(text.stdout).toContain("Recorded: already present (replay no-op)");
    });
  });

  it("registers a new Spec and sediments it in the same command", () => {
    withInitializedDirectory((cwd) => {
      createDoneTask(cwd);

      const body = "# Operator probe\n\nAlways probe before shipping.\n";
      const relativePath = ".taskcraft/spec/engineering/probe.md";
      const absolutePath = join(cwd, relativePath);
      mkdirSync(join(absolutePath, ".."), { recursive: true });
      writeFileSync(absolutePath, body, "utf8");

      const registered = sediment(
        cwd,
        ["engineering.probe"],
        [
          "--register",
          JSON.stringify([
            {
              id: "engineering.probe",
              kind: "engineering",
              path: relativePath,
              summary: "Operator probe rule",
              appliesTo: ["src/**"],
              status: "active",
            },
          ]),
        ],
      );

      expect(registered.status).toBe(0);
      expect(registered.stdout).toContain("Specs: engineering.probe");
      expect(runCli(["spec", "check"], cwd).status).toBe(0);

      // The newly registered Spec is discoverable to later tasks.
      expect(runCli(["spec", "list"], cwd).stdout).toContain(
        "engineering.probe",
      );
      expect(readSedimentations(cwd)).toHaveLength(1);
    });
  });

  it("leaves the Registry byte-identical when the command is rejected", () => {
    withInitializedDirectory((cwd) => {
      // The task is not done, so the command must fail before it appends the
      // entry: a rejected sedimentation may not mutate the Git-owned Registry.
      runCli(
        [
          "task",
          "new",
          "--title",
          "Not done yet",
          "--level",
          "1",
          "--reason",
          "registry ordering fixture",
        ],
        cwd,
      );
      const relativePath = ".taskcraft/spec/engineering/probe.md";
      const absolutePath = join(cwd, relativePath);
      mkdirSync(join(absolutePath, ".."), { recursive: true });
      writeFileSync(absolutePath, "# Probe\n", "utf8");
      const before = readRegistryBytes(cwd);

      const rejected = sediment(
        cwd,
        ["engineering.probe"],
        [
          "--register",
          JSON.stringify([
            {
              id: "engineering.probe",
              kind: "engineering",
              path: relativePath,
              summary: "Operator probe rule",
              appliesTo: ["src/**"],
              status: "active",
            },
          ]),
        ],
      );

      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("TC_SPEC_SEDIMENTATION_INVALID");
      expect(readRegistryBytes(cwd)).toBe(before);
      expect(readSedimentations(cwd)).toEqual([]);
    });
  });

  it("makes a Spec registered by one task bindable by the next", () => {
    withInitializedDirectory((cwd) => {
      createDoneTask(cwd);

      const relativePath = ".taskcraft/spec/engineering/probe.md";
      const absolutePath = join(cwd, relativePath);
      mkdirSync(join(absolutePath, ".."), { recursive: true });
      writeFileSync(
        absolutePath,
        "# Operator probe\n\nAlways probe.\n",
        "utf8",
      );

      expect(
        sediment(
          cwd,
          ["engineering.probe"],
          [
            "--register",
            JSON.stringify([
              {
                id: "engineering.probe",
                kind: "engineering",
                path: relativePath,
                summary: "Operator probe rule",
                appliesTo: ["src/**"],
                status: "active",
              },
            ]),
          ],
        ).status,
      ).toBe(0);

      // The next task discovers the new rule and binds it as its contract.
      const created = runCli(
        [
          "task",
          "new",
          "--title",
          "Later task",
          "--level",
          "1",
          "--reason",
          "the probe rule now applies",
          "--specs",
          JSON.stringify([{ id: "engineering.probe", duty: "required" }]),
        ],
        cwd,
      );
      expect(created.status).toBe(0);

      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      try {
        expect(
          getLifecycleSpecBindings(database, "T-2").map(
            (binding) => binding.specId,
          ),
        ).toContain("engineering.probe");
      } finally {
        database.close();
      }
    });
  });
});
