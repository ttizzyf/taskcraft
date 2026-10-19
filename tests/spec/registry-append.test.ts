import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import {
  appendSpecRegistryEntry,
  checkSpecRegistry,
  loadSpecRegistry,
  parseSpecRegistryEntry,
} from "../../src/spec/index.js";
import type { SpecRegistryEntry } from "../../src/spec/index.js";
import {
  entry,
  expectTaskcraftError,
  registryFile,
  withProject,
  writeBody,
  writeRegistry,
} from "./helpers.js";

describe("Spec Registry append writer", () => {
  it("appends a Registry entry for a body that already exists", () => {
    withProject((projectDir) => {
      writeRegistry(projectDir, []);
      writeBody(projectDir, "docs/testing.md", "# Testing\n");

      const appended = appendSpecRegistryEntry(
        projectDir,
        parseSpecRegistryEntry(
          entry("engineering.testing", "docs/testing.md", ["src/**"]),
        ),
      );
      expect(appended).toEqual({
        registryPath: ".taskcraft/spec/index.json",
        appended: true,
      });

      const registry = loadSpecRegistry(projectDir);
      expect(registry.specs.map((spec) => spec.id)).toEqual([
        "engineering.testing",
      ]);
      expect(registry.specs[0]?.path).toBe("docs/testing.md");
      expect(checkSpecRegistry(registry)).toMatchObject({ specCount: 1 });
    });
  });

  it("treats an identical registration as a no-op and keeps the Registry bytes", () => {
    withProject((projectDir) => {
      writeRegistry(projectDir, []);
      writeBody(projectDir, "docs/testing.md", "# Testing\n");
      const value = parseSpecRegistryEntry(
        entry("engineering.testing", "docs/testing.md", ["src/**"]),
      );

      expect(appendSpecRegistryEntry(projectDir, value).appended).toBe(true);
      const afterFirst = readFileSync(registryFile(projectDir), "utf8");

      expect(appendSpecRegistryEntry(projectDir, value).appended).toBe(false);
      expect(readFileSync(registryFile(projectDir), "utf8")).toBe(afterFirst);
      expect(loadSpecRegistry(projectDir).specs).toHaveLength(1);
    });
  });

  it("rejects a conflicting registration instead of replacing an entry", () => {
    withProject((projectDir) => {
      writeRegistry(projectDir, [
        entry("engineering.testing", "docs/testing.md"),
      ]);
      writeBody(projectDir, "docs/testing.md", "# Testing\n");
      writeBody(projectDir, "docs/other.md", "# Other\n");

      // Same id, different content.
      expectTaskcraftError(
        () =>
          appendSpecRegistryEntry(
            projectDir,
            parseSpecRegistryEntry(
              entry("engineering.testing", "docs/other.md"),
            ),
          ),
        ERROR_CODES.TC_SPEC_REGISTRY_INVALID,
      );
      // Same path, another id.
      expectTaskcraftError(
        () =>
          appendSpecRegistryEntry(
            projectDir,
            parseSpecRegistryEntry(
              entry("engineering.other", "docs/testing.md"),
            ),
          ),
        ERROR_CODES.TC_SPEC_REGISTRY_INVALID,
      );

      expect(
        loadSpecRegistry(projectDir).specs.map((spec) => spec.path),
      ).toEqual(["docs/testing.md"]);
    });
  });

  it("rejects registering a body that does not exist", () => {
    withProject((projectDir) => {
      writeRegistry(projectDir, []);

      expectTaskcraftError(
        () =>
          appendSpecRegistryEntry(
            projectDir,
            parseSpecRegistryEntry(
              entry("engineering.missing", "docs/missing.md"),
            ),
          ),
        ERROR_CODES.TC_SPEC_NOT_FOUND,
      );
      expect(loadSpecRegistry(projectDir).specs).toEqual([]);
    });
  });

  it("rejects an unknown field before it reaches the Registry", () => {
    withProject((projectDir) => {
      writeRegistry(projectDir, []);
      writeBody(projectDir, "docs/testing.md", "# Testing\n");
      const before = readFileSync(registryFile(projectDir), "utf8");
      const withUnknownField = {
        ...entry("engineering.testing", "docs/testing.md"),
        owner: "someone",
      };

      // The shared parser refuses the shape up front...
      expectTaskcraftError(
        () => parseSpecRegistryEntry(withUnknownField),
        ERROR_CODES.TC_SPEC_REGISTRY_INVALID,
      );

      // ...and the writer re-validates the exact bytes it is about to write, so
      // even a forged entry cannot land in index.json.
      expectTaskcraftError(
        () =>
          appendSpecRegistryEntry(
            projectDir,
            withUnknownField as unknown as SpecRegistryEntry,
          ),
        ERROR_CODES.TC_SPEC_REGISTRY_INVALID,
      );

      expect(readFileSync(registryFile(projectDir), "utf8")).toBe(before);
      expect(loadSpecRegistry(projectDir).specs).toEqual([]);
    });
  });
});
