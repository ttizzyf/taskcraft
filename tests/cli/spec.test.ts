import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli, withTemporaryDirectory } from "./helpers.js";

describe("tc spec", () => {
  it("lists the same resolved DTO in text and JSON", () => {
    withTemporaryDirectory((cwd) => {
      writeSpecProject(cwd);

      const text = runCli(["spec", "list"], cwd);
      expect(text.status).toBe(0);
      expect(text.stderr).toBe("");
      expect(text.stdout).toContain(
        "engineering.payment [engineering, active]",
      );
      expect(text.stdout).toContain("Summary: Payment integration contracts");

      const json = runCli(["spec", "list", "--json"], cwd);
      expect(json.status).toBe(0);
      expect(json.stderr).toBe("");
      const result = JSON.parse(json.stdout) as {
        data: {
          specs: Array<{ path: string; summary: string }>;
        };
      };
      expect(result).toMatchObject({
        schemaVersion: "tc-command-result/v1",
        ok: true,
        data: {
          schemaVersion: "tc-spec-registry/v1",
          registryPath: ".taskcraft/spec/index.json",
          specs: [
            {
              id: "engineering.payment",
              path: "docs/payment.md",
              status: "active",
            },
            {
              id: "engineering.old",
              path: "docs/old.md",
              status: "deprecated",
            },
          ],
        },
      });
      expect(text.stdout).toContain(result.data.specs[0]?.summary);
      expect(text.stdout).toContain(result.data.specs[0]!.path);
      expect(text.stdout).toContain(result.data.specs[1]!.path);
    });
  });

  it("checks the full Registry and reports counts", () => {
    withTemporaryDirectory((cwd) => {
      writeSpecProject(cwd);

      const text = runCli(["spec", "check"], cwd);
      expect(text.status).toBe(0);
      expect(text.stderr).toBe("");
      expect(text.stdout).toContain("Spec Registry valid");
      expect(text.stdout).toContain("2 (1 active, 1 deprecated)");

      const json = runCli(["spec", "check", "--json"], cwd);
      expect(JSON.parse(json.stdout)).toMatchObject({
        ok: true,
        data: {
          specCount: 2,
          activeSpecCount: 1,
          deprecatedSpecCount: 1,
        },
      });
    });
  });

  it("resolves repeated paths without creating or changing the Task Store or Registry", () => {
    withTemporaryDirectory((cwd) => {
      writeSpecProject(cwd);
      const registryFile = join(cwd, ".taskcraft", "spec", "index.json");
      const before = readFileSync(registryFile, "utf8");

      const result = runCli(
        [
          "spec",
          "resolve",
          "--path",
          "src/payment/card.ts",
          "--path",
          "README.md",
          "--json",
        ],
        cwd,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        data: {
          paths: ["src/payment/card.ts", "README.md"],
          candidates: [{ id: "engineering.payment" }],
        },
      });
      expect(readFileSync(registryFile, "utf8")).toBe(before);
      expect(existsSync(join(cwd, ".taskcraft", "taskcraft.db"))).toBe(false);
    });
  });

  it("registers a batch of existing documents in one atomic append", () => {
    withTemporaryDirectory((cwd) => {
      writeEmptyRegistry(cwd);
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(join(cwd, "docs", "a.md"), "# A\n", "utf8");
      writeFileSync(join(cwd, "docs", "b.md"), "# B\n", "utf8");

      const entries = [
        {
          id: "engineering.a",
          kind: "engineering",
          path: "docs/a.md",
          summary: "A rule",
          appliesTo: ["src/**"],
          status: "active",
        },
        {
          id: "engineering.b",
          kind: "engineering",
          path: "docs/b.md",
          summary: "B rule",
          appliesTo: ["src/**"],
          status: "active",
        },
      ];

      const registered = runCli(
        ["spec", "register", "--entries", JSON.stringify(entries), "--json"],
        cwd,
      );
      expect(registered.status).toBe(0);
      expect(JSON.parse(registered.stdout)).toMatchObject({
        ok: true,
        data: { appended: [true, true] },
      });
      expect(runCli(["spec", "list"], cwd).stdout).toContain("engineering.a");
      expect(runCli(["spec", "list"], cwd).stdout).toContain("engineering.b");
      // Registration writes only the Registry, never the Task Store.
      expect(existsSync(join(cwd, ".taskcraft", "taskcraft.db"))).toBe(false);

      // Replaying the same batch is a no-op and keeps the Registry bytes.
      const registryFile = join(cwd, ".taskcraft", "spec", "index.json");
      const before = readFileSync(registryFile, "utf8");
      const replay = runCli(
        ["spec", "register", "--entries", JSON.stringify(entries), "--json"],
        cwd,
      );
      expect(replay.status).toBe(0);
      expect(JSON.parse(replay.stdout)).toMatchObject({
        data: { appended: [false, false] },
      });
      expect(readFileSync(registryFile, "utf8")).toBe(before);
    });
  });

  it("rejects the whole batch when one entry is invalid", () => {
    withTemporaryDirectory((cwd) => {
      writeEmptyRegistry(cwd);
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(join(cwd, "docs", "a.md"), "# A\n", "utf8");
      const registryFile = join(cwd, ".taskcraft", "spec", "index.json");
      const before = readFileSync(registryFile, "utf8");

      const rejected = runCli(
        [
          "spec",
          "register",
          "--entries",
          JSON.stringify([
            {
              id: "engineering.a",
              kind: "engineering",
              path: "docs/a.md",
              summary: "A rule",
              appliesTo: ["src/**"],
              status: "active",
            },
            {
              id: "engineering.missing",
              kind: "engineering",
              path: "docs/missing.md",
              summary: "Missing body",
              appliesTo: ["src/**"],
              status: "active",
            },
          ]),
        ],
        cwd,
      );

      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("TC_SPEC_NOT_FOUND");
      // Nothing from the batch landed, including the valid first entry.
      expect(readFileSync(registryFile, "utf8")).toBe(before);
    });
  });

  it("returns stable errors for malformed, missing and unsafe inputs", () => {
    withTemporaryDirectory((cwd) => {
      const absent = runCli(["spec", "list", "--json"], cwd);
      expect(absent.status).toBe(1);
      expect(absent.stdout).toBe("");
      expect(JSON.parse(absent.stderr)).toMatchObject({
        ok: false,
        errors: [
          {
            code: "TC_SPEC_NOT_FOUND",
            remediation: "Create the empty Registry with: tc init",
          },
        ],
      });
    });

    withTemporaryDirectory((cwd) => {
      mkdirSync(join(cwd, ".taskcraft", "spec"), { recursive: true });
      writeFileSync(
        join(cwd, ".taskcraft", "spec", "index.json"),
        "{bad-json",
        "utf8",
      );
      const malformed = runCli(["spec", "list", "--json"], cwd);
      expect(malformed.status).toBe(1);
      expect(malformed.stdout).toBe("");
      expect(JSON.parse(malformed.stderr)).toMatchObject({
        ok: false,
        errors: [{ code: "TC_SPEC_REGISTRY_INVALID" }],
      });
    });

    withTemporaryDirectory((cwd) => {
      writeSpecProject(cwd, "docs/missing.md");
      const missing = runCli(["spec", "check"], cwd);
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain("TC_SPEC_NOT_FOUND");
    });

    withTemporaryDirectory((cwd) => {
      writeSpecProject(cwd);
      const unsafe = runCli(
        ["spec", "resolve", "--path", "../outside.ts"],
        cwd,
      );
      expect(unsafe.status).toBe(1);
      expect(unsafe.stderr).toContain("TC_SPEC_PATH_INVALID");

      const missingPath = runCli(["spec", "resolve"], cwd);
      expect(missingPath.status).toBe(1);
      expect(missingPath.stderr).toContain("TC_SPEC_PATH_INVALID");
    });
  });
});

function writeEmptyRegistry(cwd: string): void {
  mkdirSync(join(cwd, ".taskcraft", "spec"), { recursive: true });
  writeFileSync(
    join(cwd, ".taskcraft", "spec", "index.json"),
    JSON.stringify(
      { schemaVersion: "tc-spec-registry/v1", specs: [] },
      null,
      2,
    ),
    "utf8",
  );
}

function writeSpecProject(cwd: string, activePath = "docs/payment.md"): void {
  mkdirSync(join(cwd, ".taskcraft", "spec"), { recursive: true });
  mkdirSync(join(cwd, "docs"), { recursive: true });

  if (activePath === "docs/payment.md") {
    writeFileSync(join(cwd, activePath), "# Payment\n", "utf8");
  }
  writeFileSync(join(cwd, "docs", "old.md"), "# Old\n", "utf8");
  writeFileSync(
    join(cwd, ".taskcraft", "spec", "index.json"),
    JSON.stringify(
      {
        schemaVersion: "tc-spec-registry/v1",
        specs: [
          {
            id: "engineering.payment",
            kind: "engineering",
            path: activePath,
            summary: "Payment integration contracts",
            appliesTo: ["src/payment/**", "README.md"],
            status: "active",
          },
          {
            id: "engineering.old",
            kind: "engineering",
            path: "docs/old.md",
            summary: "Old contracts",
            appliesTo: ["src/payment/**"],
            status: "deprecated",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
}
