// The only programmatic write paths into the Spec Registry.
//
// Spec bodies stay with the Agent that writes them; this module owns the
// structured side so a Spec becomes discoverable without hand-editing
// index.json. It appends, never overwrites, and reuses the single Registry
// parser and validators instead of growing a second interpretation.

import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { specPathInvalid, specRegistryInvalid } from "./errors.js";
import { readVerifiedRegularFile, resolveProjectDirectory } from "./paths.js";
import {
  decodeUtf8Registry,
  parseRegistry,
  resolveRegistryFile,
  resolveSpecDocument,
  validateRegistryPaths,
  validateUniqueRegistryFields,
} from "./registry.js";
import {
  SPEC_REGISTRY_RELATIVE_PATH,
  SPEC_REGISTRY_SCHEMA_VERSION,
} from "./types.js";
import type { SpecRegistryEntry } from "./types.js";

export interface AppendSpecRegistryEntryResult {
  readonly registryPath: typeof SPEC_REGISTRY_RELATIVE_PATH;
  /** false when an identical entry is already registered (replay no-op). */
  readonly appended: boolean;
}

export interface AppendSpecRegistryEntriesResult {
  readonly registryPath: typeof SPEC_REGISTRY_RELATIVE_PATH;
  /** One outcome per submitted entry, in submission order. */
  readonly appended: boolean[];
}

/** Parses one caller-supplied entry through the shared Registry schema, so an
 * unknown or misspelled field fails here instead of inside index.json. */
export function parseSpecRegistryEntry(value: unknown): SpecRegistryEntry {
  const document = parseRegistry(
    JSON.stringify({
      schemaVersion: SPEC_REGISTRY_SCHEMA_VERSION,
      specs: [value],
    }),
  );
  return document.specs[0]!;
}

/** Appends one Registry entry for a body the Agent already wrote. */
export function appendSpecRegistryEntry(
  projectDir: string,
  entry: SpecRegistryEntry,
): AppendSpecRegistryEntryResult {
  const result = appendSpecRegistryEntries(projectDir, [entry]);

  return {
    registryPath: result.registryPath,
    appended: result.appended[0]!,
  };
}

/** Appends a batch of Registry entries in one read-validate-write pass.
 *
 * A bulk registration is one atomic replacement rather than N rewrites: either
 * every entry in the batch is accepted, or the Registry keeps its bytes.
 * Identity is the entry id and path, never its digest, so replaying the same
 * registration is a no-op. An existing id or path with different content is
 * rejected rather than replaced. */
export function appendSpecRegistryEntries(
  projectDir: string,
  entries: readonly SpecRegistryEntry[],
): AppendSpecRegistryEntriesResult {
  if (entries.length === 0) {
    throw specRegistryInvalid("A Registry append requires at least one entry");
  }

  const projectRealPath = resolveProjectDirectory(projectDir);
  const registryRealPath = resolveRegistryFile(
    projectRealPath,
    join(projectRealPath, SPEC_REGISTRY_RELATIVE_PATH),
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

  const specs: SpecRegistryEntry[] = [...document.specs];
  const appended: boolean[] = [];

  for (const entry of entries) {
    const registeredById = specs.find((spec) => spec.id === entry.id);
    if (registeredById !== undefined) {
      if (sameRegistryEntry(registeredById, entry)) {
        appended.push(false);
        continue;
      }

      throw specRegistryInvalid(
        `The Spec Registry already registers ${entry.id} with different content; entries are append-only`,
      );
    }
    if (specs.some((spec) => spec.path === entry.path)) {
      throw specRegistryInvalid(
        `The Spec Registry already registers the path ${entry.path} under another id`,
      );
    }

    // The body must already exist as a contained regular file before the entry
    // becomes discoverable; the Registry never registers a promise.
    resolveSpecDocument(projectRealPath, entry);
    specs.push(entry);
    appended.push(true);
  }

  if (!appended.some(Boolean)) {
    return { registryPath: SPEC_REGISTRY_RELATIVE_PATH, appended };
  }

  const serialized = `${JSON.stringify(
    { schemaVersion: SPEC_REGISTRY_SCHEMA_VERSION, specs },
    null,
    2,
  )}\n`;

  // Re-validate the exact bytes that will be written.
  const reparsed = parseRegistry(serialized);
  validateUniqueRegistryFields(reparsed.specs);
  validateRegistryPaths(reparsed.specs);

  atomicReplaceRegistry(registryRealPath, serialized);

  return { registryPath: SPEC_REGISTRY_RELATIVE_PATH, appended };
}

function sameRegistryEntry(
  left: SpecRegistryEntry,
  right: SpecRegistryEntry,
): boolean {
  return canonicalEntry(left) === canonicalEntry(right);
}

function canonicalEntry(entry: SpecRegistryEntry): string {
  return JSON.stringify({
    id: entry.id,
    kind: entry.kind,
    path: entry.path,
    summary: entry.summary,
    appliesTo: [...entry.appliesTo].sort(),
    status: entry.status,
    authority: "authority" in entry ? entry.authority : undefined,
  });
}

/** index.json is rewritten as a whole, so the replacement has to be atomic or
 * a crash would leave a truncated Registry behind. */
function atomicReplaceRegistry(path: string, contents: string): void {
  const temporary = join(dirname(path), `.index.json.tmp-${process.pid}`);

  try {
    writeFileSync(temporary, contents, { encoding: "utf8" });
    renameSync(temporary, path);
  } catch (cause) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may not exist; the original error is the signal.
    }

    throw specPathInvalid("The Spec Registry could not be replaced", cause);
  }
}
