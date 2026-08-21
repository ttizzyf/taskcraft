import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, matchesGlob, resolve } from "node:path";

import type { ValidateFunction } from "ajv";

import { createContractValidators } from "../contracts/schemas.js";
import { ERROR_CODES, TaskcraftError } from "../core/errors.js";
import {
  isFileSystemError,
  specPathInvalid,
  specRegistryInvalid,
} from "./errors.js";
import {
  assertContained,
  assertRepositoryRelativePath,
  pathEntryExists,
  readVerifiedRegularFile,
  resolveExistingRealPath,
  resolveProjectDirectory,
} from "./paths.js";
import {
  SPEC_REGISTRY_RELATIVE_PATH,
  SPEC_REGISTRY_SCHEMA_VERSION,
} from "./types.js";
import type {
  LoadedSpecRegistry,
  ResolvedSpec,
  SpecCheckResult,
  SpecRegistryEntry,
  SpecResolutionResult,
} from "./types.js";

interface RegistryDocument {
  readonly schemaVersion: typeof SPEC_REGISTRY_SCHEMA_VERSION;
  readonly specs: readonly SpecRegistryEntry[];
}

let registryValidator: ValidateFunction | undefined;
const registryDecoder = new TextDecoder("utf-8", { fatal: true });

export function emptySpecRegistryDocument(): RegistryDocument {
  return {
    schemaVersion: SPEC_REGISTRY_SCHEMA_VERSION,
    specs: [],
  };
}

/** Creates the empty Registry only when no directory entry exists at its
 * fixed path. Existing content, including malformed content, is untouched. */
export function initializeSpecRegistry(projectDir: string): boolean {
  const projectRealPath = resolveProjectDirectory(projectDir);
  const taskcraftDirectory = join(projectRealPath, ".taskcraft");
  const requestedRegistryPath = join(projectDir, SPEC_REGISTRY_RELATIVE_PATH);

  try {
    mkdirSync(taskcraftDirectory, { recursive: true });
  } catch (cause) {
    throw specPathInvalid(
      "The .taskcraft directory could not be created inside the project",
      cause,
    );
  }

  const taskcraftDirectoryRealPath = resolveExistingRealPath(
    taskcraftDirectory,
    ".taskcraft directory",
  );
  assertContained(
    projectRealPath,
    taskcraftDirectoryRealPath,
    ".taskcraft directory",
  );

  if (pathEntryExists(requestedRegistryPath)) {
    return false;
  }

  const registryDirectory = join(taskcraftDirectoryRealPath, "spec");

  try {
    mkdirSync(registryDirectory, { recursive: true });
  } catch (cause) {
    throw specPathInvalid(
      "The Spec Registry directory could not be created inside the project",
      cause,
    );
  }

  const registryDirectoryRealPath = resolveExistingRealPath(
    registryDirectory,
    "Spec Registry directory",
  );
  assertContained(
    projectRealPath,
    registryDirectoryRealPath,
    "Spec Registry directory",
  );
  const registryPath = join(registryDirectoryRealPath, "index.json");

  if (pathEntryExists(registryPath)) {
    return false;
  }

  try {
    writeFileSync(
      registryPath,
      `${JSON.stringify(emptySpecRegistryDocument(), null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    return true;
  } catch (cause) {
    if (isFileSystemError(cause) && cause.code === "EEXIST") {
      return false;
    }

    throw specPathInvalid("The Spec Registry could not be created", cause);
  }
}

/** Loads and fully validates the Registry and every referenced document. */
export function loadSpecRegistry(projectDir: string): LoadedSpecRegistry {
  const projectRealPath = resolveProjectDirectory(projectDir);
  const registryAbsolutePath = join(
    projectRealPath,
    SPEC_REGISTRY_RELATIVE_PATH,
  );
  const registryRealPath = resolveRegistryFile(
    projectRealPath,
    registryAbsolutePath,
  );
  const document = parseRegistry(
    decodeUtf8Registry(
      readVerifiedRegularFile(
        projectRealPath,
        registryRealPath,
        "The Spec Registry path",
      ),
    ),
  );

  validateUniqueRegistryFields(document.specs);
  validateRegistryPaths(document.specs);

  const resolvedSpecs = document.specs.map((entry) =>
    resolveSpecDocument(projectRealPath, entry),
  );

  return Object.freeze({
    schemaVersion: SPEC_REGISTRY_SCHEMA_VERSION,
    registryPath: SPEC_REGISTRY_RELATIVE_PATH,
    specs: Object.freeze(resolvedSpecs),
  });
}

export function checkSpecRegistry(
  registry: LoadedSpecRegistry,
): SpecCheckResult {
  const activeSpecCount = registry.specs.filter(
    (spec) => spec.status === "active",
  ).length;

  return Object.freeze({
    registryPath: SPEC_REGISTRY_RELATIVE_PATH,
    specCount: registry.specs.length,
    activeSpecCount,
    deprecatedSpecCount: registry.specs.length - activeSpecCount,
  });
}

/** Matches caller-provided repository paths against active Registry entries.
 * Matching only discovers candidates and never mutates the Registry or Store. */
export function resolveSpecCandidates(
  registry: LoadedSpecRegistry,
  paths: readonly string[],
): SpecResolutionResult {
  if (paths.length === 0) {
    throw specPathInvalid(
      "At least one repository-relative --path is required",
    );
  }

  const checkedPaths = paths.map((path) => {
    assertRepositoryRelativePath(path, "Resolve path");
    return path;
  });
  const candidates = registry.specs.filter(
    (spec) =>
      spec.status === "active" &&
      spec.appliesTo.some((pattern) =>
        checkedPaths.some((path) => matchesGlob(path, pattern)),
      ),
  );

  return Object.freeze({
    paths: Object.freeze([...checkedPaths]),
    candidates: Object.freeze([...candidates]),
  });
}

function validator(): ValidateFunction {
  registryValidator ??= createContractValidators().specRegistry;
  return registryValidator;
}

function parseRegistry(text: string): RegistryDocument {
  let value: unknown;

  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    throw specRegistryInvalid("The Spec Registry is not valid JSON", cause);
  }

  const validate = validator();

  if (!validate(value)) {
    const details = (validate.errors ?? [])
      .map(
        (error) =>
          `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
      )
      .join("; ");
    throw specRegistryInvalid(
      `The Spec Registry does not match tc-spec-registry/v1${details.length === 0 ? "" : `: ${details}`}`,
    );
  }

  return value as RegistryDocument;
}

function validateUniqueRegistryFields(
  entries: readonly SpecRegistryEntry[],
): void {
  assertUnique(entries, "id");
  assertUnique(entries, "path");
}

function assertUnique(
  entries: readonly SpecRegistryEntry[],
  field: "id" | "path",
): void {
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry[field])) {
      throw specRegistryInvalid(
        `The Spec Registry contains duplicate ${field}: ${entry[field]}`,
      );
    }

    seen.add(entry[field]);
  }
}

function validateRegistryPaths(entries: readonly SpecRegistryEntry[]): void {
  for (const entry of entries) {
    assertRepositoryRelativePath(entry.path, `Spec ${entry.id} path`);

    for (const pattern of entry.appliesTo) {
      assertRepositoryRelativePattern(pattern, entry.id);
    }
  }
}

function resolveSpecDocument(
  projectRealPath: string,
  entry: SpecRegistryEntry,
): ResolvedSpec {
  const absolutePath = resolve(projectRealPath, entry.path);
  let realPath: string;

  try {
    realPath = realpathSync(absolutePath);
  } catch (cause) {
    if (isFileSystemError(cause) && cause.code === "ENOENT") {
      throw new TaskcraftError(ERROR_CODES.TC_SPEC_NOT_FOUND, {
        problem: `Spec ${entry.id} references a missing file: ${entry.path}`,
        impact: "The Registry cannot be used for Spec discovery",
        remediation:
          "Restore the file or remove the Registry entry, then run: tc spec check",
        context: { specId: entry.id, path: entry.path },
        cause,
      });
    }

    throw specPathInvalid(
      `Spec ${entry.id} path cannot be resolved: ${entry.path}`,
      cause,
    );
  }

  assertContained(projectRealPath, realPath, `Spec ${entry.id} path`);
  const content = readVerifiedRegularFile(
    projectRealPath,
    realPath,
    `Spec ${entry.id} path ${entry.path}`,
  );

  return Object.freeze({
    ...entry,
    appliesTo: Object.freeze([...entry.appliesTo]),
    digest: createHash("sha256").update(content).digest("hex"),
  });
}

function resolveRegistryFile(
  projectRealPath: string,
  registryAbsolutePath: string,
): string {
  let registryRealPath: string;

  try {
    registryRealPath = realpathSync(registryAbsolutePath);
  } catch (cause) {
    if (isFileSystemError(cause) && cause.code === "ENOENT") {
      throw new TaskcraftError(ERROR_CODES.TC_SPEC_NOT_FOUND, {
        problem: `Spec Registry not found at ${SPEC_REGISTRY_RELATIVE_PATH}`,
        impact: "Specs cannot be listed, checked or resolved",
        remediation: "Create the empty Registry with: tc init",
        context: { path: SPEC_REGISTRY_RELATIVE_PATH },
        cause,
      });
    }

    throw specPathInvalid("The Spec Registry path cannot be resolved", cause);
  }

  assertContained(projectRealPath, registryRealPath, "Spec Registry path");

  return registryRealPath;
}

function decodeUtf8Registry(content: Buffer): string {
  try {
    return registryDecoder.decode(content);
  } catch (cause) {
    throw specRegistryInvalid(
      "The Spec Registry is not valid UTF-8 JSON",
      cause,
    );
  }
}

function assertRepositoryRelativePattern(
  pattern: string,
  specId: string,
): void {
  try {
    assertRepositoryRelativePath(pattern, `Spec ${specId} appliesTo pattern`);
    matchesGlob("__taskcraft_pattern_probe__", pattern);
  } catch (cause) {
    if (cause instanceof TaskcraftError) {
      throw specRegistryInvalid(cause.problem, cause);
    }
    throw specRegistryInvalid(
      `Spec ${specId} has an invalid appliesTo pattern: ${pattern}`,
      cause,
    );
  }
}
