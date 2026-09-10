import { describe, expect, it } from "vitest";

import type { CaseSetup } from "../../core/types.ts";
import { actorPrompt } from "../../cases/utils.ts";

const setup: CaseSetup = {
  taskId: "T-1",
  workspace: "/tmp/fixture",
  requirement: "csv contract",
  modelCriteria: [],
  metadata: {},
};

describe("actor prompt task inspection", () => {
  it("uses task show for attempt discovery", () => {
    const prompt = actorPrompt(setup, "validation", "continue");
    expect(prompt).toContain("tc task show T-1 --json");
    expect(prompt).not.toContain("tc status T-1");
  });
});
