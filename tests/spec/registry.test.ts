import {
  chmodSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ERROR_CODES, TaskcraftError } from "../../src/core/errors.js";
import {
  initializeSpecRegistry,
  loadSpecRegistry,
  resolveSpecCandidates,
} from "../../src/spec/index.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

interface RegistryEntryInput {
  id: string;
  kind: "engineering" | "domain";
  path: string;
  summary: string;
  appliesTo: string[];
  status: "active" | "deprecated";
  authority?: string;
}

describe("Spec Registry service", () => {
  it("loads repository files, returns immutable DTOs and hashes exact bytes", () => {
    withProject((projectDir) => {
      const taskcraftBody = Buffer.from([
        0xef, 0xbb, 0xbf, 0x23, 0x20, 0x4c, 0x6f, 0x63, 0x61, 0x6c, 0x0d, 0x0a,
      ]);
      const existingBody = "# Existing repository guide\n";
      writeBody(projectDir, ".taskcraft/spec/local.md", taskcraftBody);
      writeBody(projectDir, "docs/existing.md", existingBody);
      writeRegistry(projectDir, [
        entry("engineering.local", ".taskcraft/spec/local.md", ["src/**"]),
        entry("engineering.existing", "docs/existing.md", ["scripts/**"]),
      ]);

      const registry = loadSpecRegistry(projectDir);

      expect(registry).toMatchObject({
        schemaVersion: "tc-spec-registry/v1",
        registryPath: ".taskcraft/spec/index.json",
      });
      expect(registry.specs).toHaveLength(2);
      expect(registry.specs[0]?.digest).toBe(
        createHash("sha256").update(taskcraftBody).digest("hex"),
      );
      expect(registry.specs[1]?.digest).toBe(
        createHash("sha256").update(existingBody).digest("hex"),
      );
      expect(Object.isFrozen(registry)).toBe(true);
      expect(Object.isFrozen(registry.specs)).toBe(true);
      expect(Object.isFrozen(registry.specs[0]?.appliesTo)).toBe(true);
    });
  });

  it("returns each matching active Spec once and never selects deprecated entries", () => {
    withProject((projectDir) => {
      writeBody(projectDir, "docs/payment.md", "payment");
      writeBody(projectDir, "docs/readme.md", "readme");
      writeBody(projectDir, "docs/old.md", "old");
      writeRegistry(projectDir, [
        entry("engineering.payment", "docs/payment.md", ["src/payment/**"]),
        entry("engineering.readme", "docs/readme.md", ["README.md"]),
        {
          ...entry("engineering.old", "docs/old.md", ["src/payment/**"]),
          status: "deprecated",
        },
      ]);

      const result = resolveSpecCandidates(loadSpecRegistry(projectDir), [
        "src/payment/card.ts",
        "src/payment/refund.ts",
        "README.md",
      ]);

      expect(result.paths).toEqual([
        "src/payment/card.ts",
        "src/payment/refund.ts",
        "README.md",
      ]);
      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        "engineering.payment",
        "engineering.readme",
      ]);
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  it("rejects malformed JSON and domain entries without authority", () => {
    withProject((projectDir) => {
      writeBody(projectDir, "docs/domain.md", "domain");
      const registryPath = registryFile(projectDir);
      mkdirSync(join(projectDir, ".taskcraft", "spec"), { recursive: true });
      writeFileSync(registryPath, "{bad-json", "utf8");
      expectTaskcraftError(
        () => loadSpecRegistry(projectDir),
        ERROR_CODES.TC_SPEC_REGISTRY_INVALID,
      );

      writeRegistry(projectDir, [
        {
          ...entry("domain.billing", "docs/domain.md", ["src/billing/**"]),
          kind: "domain",
        },
      ]);
      expectTaskcraftError(
        () => loadSpecRegistry(projectDir),
        ERROR_CODES.TC_SPEC_REGISTRY_INVALID,
      );
    });
  });

  it("rejects invalid UTF-8 even when replacement decoding would form valid Registry JSON", () => {
    withProject((projectDir) => {
      writeBody(projectDir, "docs/invalid-utf8.md", "body");
      mkdirSync(join(projectDir, ".taskcraft", "spec"), { recursive: true });
      const prefix = Buffer.from(
        '{"schemaVersion":"tc-spec-registry/v1","specs":[{"id":"engineering.utf8","kind":"engineering","path":"docs/invalid-utf8.md","summary":"',
      );
      const suffix = Buffer.from(
        '","appliesTo":["src/**"],"status":"active"}]}',
      );
      writeFileSync(
        registryFile(projectDir),
        Buffer.concat([prefix, Buffer.from([0xff]), suffix]),
      );

      const error = expectTaskcraftError(
        () => loadSpecRegistry(projectDir),
        ERROR_CODES.TC_SPEC_REGISTRY_INVALID,
      );
      expect(error.problem).toContain("UTF-8");
    });
  });

  it.each([
    { ...entry("engineering.valid", "docs/a.md"), id: "Engineering.Bad" },
    { ...entry("engineering.valid", "docs/a.md"), unknown: true },
  ])("uses the production Schema validator for invalid entry %#", (invalid) => {
    withProject((projectDir) => {
      writeBody(projectDir, "docs/a.md", "a");
      writeRegistry(projectDir, [invalid]);

      expectTaskcraftError(
        () => loadSpecRegistry(projectDir),
        ERROR_CODES.TC_SPEC_REGISTRY_INVALID,
      );
    });
  });

  it.each([
    [
      "id",
      [
        entry("engineering.same", "docs/a.md"),
        entry("engineering.same", "docs/b.md"),
      ],
    ],
    [
      "path",
      [
        entry("engineering.a", "docs/a.md"),
        entry("engineering.b", "docs/a.md"),
      ],
    ],
  ])("rejects duplicate %s values", (_field, entries) => {
    withProject((projectDir) => {
      writeBody(projectDir, "docs/a.md", "a");
      writeBody(projectDir, "docs/b.md", "b");
      writeRegistry(projectDir, entries);

      expectTaskcraftError(
        () => loadSpecRegistry(projectDir),
        ERROR_CODES.TC_SPEC_REGISTRY_INVALID,
      );
    });
  });

  it.each([
    "/tmp/outside.md",
    "C:outside.md",
    "../outside.md",
    "docs/../outside.md",
  ])("rejects non-canonical Registry path %s", (path) => {
    withProject((projectDir) => {
      writeRegistry(projectDir, [entry("engineering.bad", path)]);

      expectTaskcraftError(
        () => loadSpecRegistry(projectDir),
        ERROR_CODES.TC_SPEC_PATH_INVALID,
      );
    });
  });

  it("rejects missing files and directories with stable errors", () => {
    withProject((projectDir) => {
      writeRegistry(projectDir, [
        entry("engineering.missing", "docs/missing.md"),
      ]);
      expectTaskcraftError(
        () => loadSpecRegistry(projectDir),
        ERROR_CODES.TC_SPEC_NOT_FOUND,
      );

      mkdirSync(join(projectDir, "docs", "directory.md"), { recursive: true });
      writeRegistry(projectDir, [
        entry("engineering.directory", "docs/directory.md"),
      ]);
      expectTaskcraftError(
        () => loadSpecRegistry(projectDir),
        ERROR_CODES.TC_SPEC_PATH_INVALID,
      );
    });
  });

  it("validates deprecated files and gives remediation consistent with that behavior", () => {
    withProject((projectDir) => {
      writeRegistry(projectDir, [
        {
          ...entry("engineering.old", "docs/missing-old.md"),
          status: "deprecated",
        },
      ]);

      const error = expectTaskcraftError(
        () => loadSpecRegistry(projectDir),
        ERROR_CODES.TC_SPEC_NOT_FOUND,
      );
      expect(error.remediation).toBe(
        "Restore the file or remove the Registry entry, then run: tc spec check",
      );
    });
  });

  it("rejects Spec and Registry symlinks that escape the project", () => {
    const outside = createTemporaryDirectory();

    try {
      writeBody(outside.path, "outside.md", "outside");
      withProject((projectDir) => {
        mkdirSync(join(projectDir, "docs"), { recursive: true });
        symlinkSync(
          join(outside.path, "outside.md"),
          join(projectDir, "docs", "escape.md"),
        );
        writeRegistry(projectDir, [
          entry("engineering.escape", "docs/escape.md"),
        ]);
        expectTaskcraftError(
          () => loadSpecRegistry(projectDir),
          ERROR_CODES.TC_SPEC_PATH_INVALID,
        );
      });

      withProject((projectDir) => {
        const escapedRegistry = join(outside.path, "index.json");
        writeFileSync(
          escapedRegistry,
          JSON.stringify({ schemaVersion: "tc-spec-registry/v1", specs: [] }),
          "utf8",
        );
        mkdirSync(join(projectDir, ".taskcraft", "spec"), { recursive: true });
        symlinkSync(escapedRegistry, registryFile(projectDir));
        expectTaskcraftError(
          () => loadSpecRegistry(projectDir),
          ERROR_CODES.TC_SPEC_PATH_INVALID,
        );
      });
    } finally {
      outside.cleanup();
    }
  });

  it("does not create Registry directories through an escaping .taskcraft symlink", () => {
    const project = createTemporaryDirectory();
    const outside = createTemporaryDirectory();

    try {
      symlinkSync(outside.path, join(project.path, ".taskcraft"), "dir");

      expectTaskcraftError(
        () => initializeSpecRegistry(project.path),
        ERROR_CODES.TC_SPEC_PATH_INVALID,
      );
      expect(existsSync(join(outside.path, "spec"))).toBe(false);
    } finally {
      project.cleanup();
      outside.cleanup();
    }
  });

  // POSIX-only: `chmod 0o000` clears the read bit on POSIX, but on Windows it
  // only toggles the read-only attribute and the file stays readable, so no
  // registry error can be raised. There is no Windows equivalent short of
  // rewriting the ACLs.
  it.skipIf(process.platform === "win32")(
    "rejects unreadable Spec files",
    () => {
      withProject((projectDir) => {
        const path = join(projectDir, "docs", "private.md");
        writeBody(projectDir, "docs/private.md", "private");
        writeRegistry(projectDir, [
          entry("engineering.private", "docs/private.md"),
        ]);
        chmodSync(path, 0o000);

        try {
          expectTaskcraftError(
            () => loadSpecRegistry(projectDir),
            ERROR_CODES.TC_SPEC_PATH_INVALID,
          );
        } finally {
          chmodSync(path, 0o600);
        }
      });
    },
  );

  it.each([
    { paths: [] },
    { paths: ["/absolute.ts"] },
    { paths: ["C:outside.ts"] },
    { paths: ["src/../outside.ts"] },
  ])("rejects invalid resolve paths %#", ({ paths }) => {
    withProject((projectDir) => {
      writeRegistry(projectDir, []);
      expectTaskcraftError(
        () => resolveSpecCandidates(loadSpecRegistry(projectDir), paths),
        ERROR_CODES.TC_SPEC_PATH_INVALID,
      );
    });
  });
});

function withProject(callback: (projectDir: string) => void): void {
  const project = createTemporaryDirectory();

  try {
    callback(project.path);
  } finally {
    project.cleanup();
  }
}

function entry(
  id: string,
  path: string,
  appliesTo: string[] = ["src/**"],
): RegistryEntryInput {
  return {
    id,
    kind: "engineering",
    path,
    summary: `${id} summary`,
    appliesTo,
    status: "active",
  };
}

function writeBody(
  projectDir: string,
  path: string,
  body: string | Buffer,
): void {
  const absolutePath = join(projectDir, path);
  mkdirSync(join(absolutePath, ".."), { recursive: true });

  if (typeof body === "string") {
    writeFileSync(absolutePath, body, "utf8");
  } else {
    writeFileSync(absolutePath, body);
  }
}

function writeRegistry(projectDir: string, specs: readonly unknown[]): void {
  mkdirSync(join(projectDir, ".taskcraft", "spec"), { recursive: true });
  writeFileSync(
    registryFile(projectDir),
    JSON.stringify({ schemaVersion: "tc-spec-registry/v1", specs }, null, 2),
    "utf8",
  );
}

function registryFile(projectDir: string): string {
  return join(projectDir, ".taskcraft", "spec", "index.json");
}

function expectTaskcraftError(
  action: () => unknown,
  code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
): TaskcraftError {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(TaskcraftError);
    expect((error as TaskcraftError).code).toBe(code);
    return error as TaskcraftError;
  }
}
