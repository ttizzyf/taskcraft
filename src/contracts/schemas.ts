import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  Ajv2020,
  type AnySchema,
  type ValidateFunction,
} from "ajv/dist/2020.js";

export const contractPaths = Object.freeze({
  lifecycleSchema: fileURLToPath(
    new URL(
      "../../development/contracts/lifecycle.schema.json",
      import.meta.url,
    ),
  ),
  breadcrumbSchema: fileURLToPath(
    new URL(
      "../../development/contracts/breadcrumb.schema.json",
      import.meta.url,
    ),
  ),
  l2TaskFixture: fileURLToPath(
    new URL(
      "../../development/contracts/fixtures/l2-task.fixture.json",
      import.meta.url,
    ),
  ),
});

export interface ContractValidators {
  lifecycle: ValidateFunction;
  breadcrumb: ValidateFunction;
}

export function loadJsonFile(filename: string): unknown {
  return JSON.parse(readFileSync(filename, "utf8")) as unknown;
}

export function createContractValidators(): ContractValidators {
  const ajv = new Ajv2020({ strict: true, allErrors: true });

  return {
    lifecycle: ajv.compile(loadSchema(contractPaths.lifecycleSchema)),
    breadcrumb: ajv.compile(loadSchema(contractPaths.breadcrumbSchema)),
  };
}

function loadSchema(filename: string): AnySchema {
  return loadJsonFile(filename) as AnySchema;
}

export function loadL2TaskFixture(): unknown {
  return loadJsonFile(contractPaths.l2TaskFixture);
}
