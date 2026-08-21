import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/store/database.js";
import { getLifecycleSpecBindings } from "../../src/store/query.js";
import { runCli, withInitializedDirectory } from "./helpers.js";

describe("tc task Spec lifecycle inputs", () => {
  it("accepts confirmed Spec selections from @path and @-", () => {
    withInitializedDirectory((cwd) => {
      writeRegistry(cwd);
      const selection = '[{"id":"engineering.core","duty":"required"}]';
      writeFileSync(join(cwd, "specs.json"), selection, "utf8");

      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "File selection",
            "--level",
            "1",
            "--reason",
            "confirmed contract",
            "--specs",
            "@specs.json",
          ],
          cwd,
        ).status,
      ).toBe(0);
      expect(
        runCli(
          [
            "task",
            "new",
            "--title",
            "Stdin selection",
            "--level",
            "1",
            "--reason",
            "confirmed contract",
            "--specs",
            "@-",
          ],
          cwd,
          selection,
        ).status,
      ).toBe(0);

      const database = openDatabase(join(cwd, ".taskcraft", "taskcraft.db"));
      expect(getLifecycleSpecBindings(database, "T-1")).toHaveLength(2);
      expect(getLifecycleSpecBindings(database, "T-2")).toHaveLength(2);
      database.close();
    });
  });
});

function writeRegistry(cwd: string): void {
  mkdirSync(join(cwd, "docs"), { recursive: true });
  writeFileSync(join(cwd, "docs", "core.md"), "# Core\n", "utf8");
  writeFileSync(
    join(cwd, ".taskcraft", "spec", "index.json"),
    JSON.stringify({
      schemaVersion: "tc-spec-registry/v1",
      specs: [
        {
          id: "engineering.core",
          kind: "engineering",
          path: "docs/core.md",
          summary: "Core contract",
          appliesTo: ["src/**"],
          status: "active",
        },
      ],
    }),
    "utf8",
  );
}
