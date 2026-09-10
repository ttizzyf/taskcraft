import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  gradeCsvArtifact,
  CSV_VALID_INPUT,
  CSV_EXPECTED,
} from "../../cases/csv.ts";

const directories: string[] = [];

function fixtureWorkspace(name: string, implementation: string): string {
  const workspace = join(
    tmpdir(),
    `tc-eval-csv-${name}-${Math.random().toString(36).slice(2)}`,
  );
  directories.push(workspace);
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(
    join(workspace, "src", "csv-summary.mjs"),
    implementation,
    "utf8",
  );
  return workspace;
}

// A correct RFC 4180 implementation for the fixture contract.
const CORRECT = `import { readFileSync } from "node:fs";

const text = readFileSync(0, "utf8");
const lines = text.split(/\\r?\\n/).filter((line) => line.trim() !== "");
if (lines[0]?.trim() !== "name,amount") {
  process.stderr.write("expected name,amount header\\n");
  process.exit(1);
}
const totals = {};
let rows = 0;
for (const line of lines.slice(1)) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  if (quoted || fields.length !== 2 || fields[0]?.trim() === "") {
    process.stderr.write("malformed row: " + line + "\\n");
    process.exit(1);
  }
  const amount = Number(fields[1]?.trim());
  if (!Number.isFinite(amount)) {
    process.stderr.write("amount must be numeric: " + line + "\\n");
    process.exit(1);
  }
  totals[fields[0]] = (totals[fields[0]] ?? 0) + amount;
  rows++;
}
process.stdout.write(JSON.stringify({ rows, totals }) + "\\n");
`;

// The seeded defect: splits on every comma, so quoted cells break apart.
const DEFECT = `import { readFileSync } from "node:fs";
const lines = readFileSync(0, "utf8").trim().split(/\\r?\\n/);
const [header, ...rows] = lines;
if (header !== "name,amount") throw new Error("expected name,amount header");
const totals = {};
for (const row of rows) {
  const [name, amountText] = row.split(",");
  const amount = Number(amountText);
  if (!Number.isFinite(amount)) throw new Error("amount must be numeric");
  totals[name] = (totals[name] ?? 0) + amount;
}
process.stdout.write(JSON.stringify({ rows: rows.length, totals }) + "\\n");
`;

afterEach(() => {
  for (const directory of directories)
    rmSync(directory, { recursive: true, force: true });
  directories.length = 0;
});

describe("csv artifact oracle", () => {
  it("passes a known-correct implementation", async () => {
    const checks = await gradeCsvArtifact(fixtureWorkspace("good", CORRECT));
    expect(checks.find((check) => check.id === "csv-functional")?.verdict).toBe(
      "pass",
    );
    expect(
      checks.find((check) => check.id === "csv-invalid-input")?.verdict,
    ).toBe("pass");
    expect(
      checks.find((check) => check.id === "csv-malformed-row")?.verdict,
    ).toBe("pass");
  });

  it("fails a defect that cannot parse quoted cells", async () => {
    const checks = await gradeCsvArtifact(fixtureWorkspace("defect", DEFECT));
    expect(checks.find((check) => check.id === "csv-functional")?.verdict).toBe(
      "fail",
    );
  });

  it("fails when repeated names are overwritten instead of summed", async () => {
    const overwrite = CORRECT.replace(
      "(totals[fields[0]] ?? 0) + amount",
      "amount",
    );
    const checks = await gradeCsvArtifact(
      fixtureWorkspace("overwrite", overwrite),
    );
    expect(checks.find((check) => check.id === "csv-functional")?.verdict).toBe(
      "fail",
    );
  });

  it("fails when the artifact is missing", async () => {
    const missing = join(
      tmpdir(),
      `tc-eval-csv-missing-${Math.random().toString(36).slice(2)}`,
    );
    directories.push(missing);
    mkdirSync(join(missing, "src"), { recursive: true });
    const checks = await gradeCsvArtifact(missing);
    expect(checks[0]?.id).toBe("csv-functional");
    expect(checks[0]?.verdict).toBe("fail");
  });
});

describe("csv fixture contract data", () => {
  it("encodes quoted names and escaped quotes in the expected totals", () => {
    expect(CSV_VALID_INPUT).toContain('"North, Inc."');
    expect(Object.keys(CSV_EXPECTED.totals)).toEqual([
      "North, Inc.",
      'Quote "Co"',
      "Plain",
    ]);
  });
});
