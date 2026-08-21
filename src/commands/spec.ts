// tc spec: read-only access to the Git-owned project Spec Registry. All three
// subcommands consume the same src/spec DTOs used by JSON output; no command
// opens or writes the Task Store.

import type { Command } from "commander";

import {
  checkSpecRegistry,
  loadSpecRegistry,
  resolveSpecCandidates,
} from "../spec/index.js";
import type {
  LoadedSpecRegistry,
  ResolvedSpec,
  SpecCheckResult,
  SpecResolutionResult,
} from "../spec/index.js";
import { execute, isJsonMode, printCommandResult } from "./helpers.js";

export function register(program: Command): void {
  const spec = program
    .command("spec")
    .description("inspect the project Spec Registry");

  spec
    .command("list")
    .description("list registered Specs and their current digests")
    .action(async (_options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const registry = loadSpecRegistry(process.cwd());

        if (json) {
          printCommandResult(registry);
        } else {
          console.log(renderSpecList(registry));
        }
      }, json);
    });

  spec
    .command("check")
    .description("validate the Registry and all referenced Spec files")
    .action(async (_options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const result = checkSpecRegistry(loadSpecRegistry(process.cwd()));

        if (json) {
          printCommandResult(result);
        } else {
          console.log(renderSpecCheck(result));
        }
      }, json);
    });

  spec
    .command("resolve")
    .description("find active Spec candidates for repository paths")
    .option(
      "--path <path>",
      "repository-relative path; repeat for multiple paths",
      collectPath,
      [],
    )
    .action(async (options, command) => {
      const json = isJsonMode(command);

      await execute(() => {
        const result = resolveSpecCandidates(
          loadSpecRegistry(process.cwd()),
          options.path as string[],
        );

        if (json) {
          printCommandResult(result);
        } else {
          console.log(renderSpecResolution(result));
        }
      }, json);
    });
}

function collectPath(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function renderSpecList(registry: LoadedSpecRegistry): string {
  const lines = [`Spec Registry: ${registry.registryPath}`];

  if (registry.specs.length === 0) {
    lines.push("Specs: none");
    return lines.join("\n");
  }

  lines.push(`Specs: ${registry.specs.length}`);

  for (const spec of registry.specs) {
    lines.push(...renderSpec(spec));
  }

  return lines.join("\n");
}

function renderSpecCheck(result: SpecCheckResult): string {
  return [
    `Spec Registry valid: ${result.registryPath}`,
    `Specs: ${result.specCount} (${result.activeSpecCount} active, ${result.deprecatedSpecCount} deprecated)`,
  ].join("\n");
}

function renderSpecResolution(result: SpecResolutionResult): string {
  const lines = [
    `Paths: ${result.paths.join(", ")}`,
    `Candidates: ${result.candidates.length}`,
  ];

  for (const spec of result.candidates) {
    lines.push(...renderSpec(spec));
  }

  return lines.join("\n");
}

function renderSpec(spec: ResolvedSpec): string[] {
  return [
    `- ${spec.id} [${spec.kind}, ${spec.status}]`,
    `  Path: ${spec.path}`,
    `  Summary: ${spec.summary}`,
    `  Applies to: ${spec.appliesTo.length === 0 ? "none" : spec.appliesTo.join(", ")}`,
    ...(spec.authority === undefined ? [] : [`  Authority: ${spec.authority}`]),
    `  SHA-256: ${spec.digest}`,
  ];
}
