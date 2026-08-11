import { resolve } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({
  overrideConfigFile: resolve("eslint.config.mjs"),
});

function sourceWithEffectiveLines(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `globalThis["line${index}"] = ${index};`,
  ).join("\n");
}

async function lintLineCount(filePath: string, lineCount: number) {
  const [result] = await eslint.lintText(sourceWithEffectiveLines(lineCount), {
    filePath: resolve(filePath),
  });

  return result;
}

describe("ESLint max-lines policy", () => {
  it("accepts 400 effective source lines", async () => {
    const result = await lintLineCount("src/line-count.ts", 400);

    expect(result?.errorCount).toBe(0);
  });

  it("rejects 401 effective source lines", async () => {
    const result = await lintLineCount("src/line-count.ts", 401);

    expect(result?.messages).toContainEqual(
      expect.objectContaining({ ruleId: "max-lines", severity: 2 }),
    );
  });

  it("does not exempt test files", async () => {
    const result = await lintLineCount("tests/line-count.test.ts", 401);

    expect(result?.messages).toContainEqual(
      expect.objectContaining({ ruleId: "max-lines", severity: 2 }),
    );
  });
});
