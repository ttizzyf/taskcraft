import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/core/errors.js";
import { project } from "../../src/core/projector.js";
import { createContractValidators } from "../../src/contracts/schemas.js";
import { getAttempts } from "../../src/store/query.js";
import { loadFixtureFile } from "../helpers/load-fixture.js";
import { createMigratedDatabase } from "../store/helpers.js";

describe("projector fixtures", () => {
  it("projects the l1-pass fixture as done with no next command", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "l1-pass");

      const projection = project(database, "T-101");

      expect(projection.status).toBe("done");
      expect(projection.next).toBeNull();
      expect(projection.waitingReason).toBeNull();
      expect(projection.runnableNodes).toEqual([]);
      expect(projection.runningNode).toBeNull();
      expect(projection.doneObligations).toBe(3);
      expect(projection.totalObligations).toBe(3);
      expect(
        projection.nodeStatuses.map((node) => [node.nodeId, node.status]),
      ).toEqual([
        ["execute-1", "satisfied"],
        ["record-1", "satisfied"],
      ]);
    } finally {
      database.close();
    }
  });

  it("cannot project done when validation evidence is missing, and observations never drive completion", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "validation-missing");

      const agentRuns = database
        .prepare(
          "SELECT COUNT(*) AS count FROM agent_runs WHERE task_id = 'T-102'",
        )
        .get() as { count: number };
      expect(agentRuns.count).toBe(1);

      const projection = project(database, "T-102");

      expect(projection.status).toBe("active");
      expect(projection.doneObligations).toBe(0);
      expect(projection.runningNode).toBe("execute-1");
      expect(projection.next).toBe("tc run complete T-102");
    } finally {
      database.close();
    }
  });

  it("projects all five public statuses from the five-status fixture", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "five-status");

      expect(project(database, "T-501")).toMatchObject({
        status: "queued",
        next: "tc run T-501",
        waitingReason: null,
      });
      expect(project(database, "T-502")).toMatchObject({
        status: "active",
        runningNode: "execute-1",
        next: "tc run complete T-502",
      });
      expect(project(database, "T-503")).toMatchObject({
        status: "waiting",
        waitingReason: "needs_input",
        next: null,
      });
      expect(project(database, "T-504")).toMatchObject({
        status: "done",
        next: null,
        doneObligations: 3,
        totalObligations: 3,
      });
      expect(project(database, "T-505")).toMatchObject({
        status: "cancelled",
        next: "tc task show T-505",
      });
    } finally {
      database.close();
    }
  });

  it("projects retry exhaustion as waiting with the typed waiting reason", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "retry-exhaustion");

      const projection = project(database, "T-107");

      expect(projection.status).toBe("waiting");
      expect(projection.waitingReason).toBe("failed_retries_exhausted");
      expect(projection.runnableNodes).toEqual([]);
      expect(projection.runningNode).toBeNull();
      expect(projection.next).toBe("tc run T-107 --node execute-1");
    } finally {
      database.close();
    }
  });

  it("projects the cancel fixture as cancelled with the terminated attempt", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "cancel");

      const projection = project(database, "T-106");

      expect(projection.status).toBe("cancelled");
      expect(projection.next).toBe("tc task show T-106");
      expect(getAttempts(database, "T-106")).toEqual([
        expect.objectContaining({ status: "cancelled", outcome: "abandoned" }),
      ]);
    } finally {
      database.close();
    }
  });

  it("throws TC_TASK_NOT_FOUND for an unknown task", () => {
    const database = createMigratedDatabase();

    try {
      try {
        project(database, "T-999");
        throw new Error("expected project to throw");
      } catch (error) {
        expect(error).toMatchObject({ code: ERROR_CODES.TC_TASK_NOT_FOUND });
      }
    } finally {
      database.close();
    }
  });
});

describe("projector breadcrumb", () => {
  it("emits schema-valid breadcrumbs for every public status", () => {
    const database = createMigratedDatabase();
    const validators = createContractValidators();

    try {
      loadFixtureFile(database, "five-status");
      loadFixtureFile(database, "retry-exhaustion");

      for (const taskId of [
        "T-501",
        "T-502",
        "T-503",
        "T-504",
        "T-505",
        "T-107",
      ]) {
        const breadcrumb = project(database, taskId).breadcrumb;

        expect(validators.breadcrumb(breadcrumb)).toBe(true);
        expect(validators.breadcrumb.errors).toBeNull();
      }

      expect(project(database, "T-503").breadcrumb.task).toMatchObject({
        status: "waiting",
        waitingReason: "needs_input",
      });
      expect(project(database, "T-505").breadcrumb.task).toMatchObject({
        status: "cancelled",
      });
    } finally {
      database.close();
    }
  });

  it("ties the breadcrumb next to the projected unique next command", () => {
    const database = createMigratedDatabase();

    try {
      loadFixtureFile(database, "validation-missing");
      loadFixtureFile(database, "l1-pass");

      expect(project(database, "T-102").breadcrumb.next).toEqual({
        command: "tc run complete T-102",
      });
      expect(project(database, "T-101").breadcrumb.next.command).toBe(
        "tc task show T-101 --json",
      );
    } finally {
      database.close();
    }
  });
});
