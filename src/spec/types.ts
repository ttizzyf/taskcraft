export const SPEC_REGISTRY_SCHEMA_VERSION = "tc-spec-registry/v1";
export const SPEC_REGISTRY_RELATIVE_PATH = ".taskcraft/spec/index.json";

export type SpecKind = "engineering" | "domain";
export type SpecStatus = "active" | "deprecated";

interface SpecRegistryEntryBase {
  readonly id: string;
  readonly path: string;
  readonly summary: string;
  readonly appliesTo: readonly string[];
  readonly status: SpecStatus;
}

export type SpecRegistryEntry =
  | (SpecRegistryEntryBase & {
      readonly kind: "engineering";
      readonly authority?: string;
    })
  | (SpecRegistryEntryBase & {
      readonly kind: "domain";
      readonly authority: string;
    });

export type ResolvedSpec = SpecRegistryEntry & {
  readonly digest: string;
};

export interface LoadedSpecRegistry {
  readonly schemaVersion: typeof SPEC_REGISTRY_SCHEMA_VERSION;
  readonly registryPath: typeof SPEC_REGISTRY_RELATIVE_PATH;
  readonly specs: readonly ResolvedSpec[];
}

export interface SpecCheckResult {
  readonly registryPath: typeof SPEC_REGISTRY_RELATIVE_PATH;
  readonly specCount: number;
  readonly activeSpecCount: number;
  readonly deprecatedSpecCount: number;
}

export interface SpecResolutionResult {
  readonly paths: readonly string[];
  readonly candidates: readonly ResolvedSpec[];
}
