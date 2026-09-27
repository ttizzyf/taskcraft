import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import type { WatchBoard } from "../../src/watch/routes.js";
import { CLI_PATH, runCli } from "../cli/helpers.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

describe("tc watch CLI", () => {
  // POSIX-only: `child.kill("SIGINT")` maps to a real signal on POSIX, so the
  // CLI's SIGINT handler runs and the process exits 0. On Windows libuv has no
  // signal delivery and terminates the process outright, so `exit` reports a
  // null code. A real Ctrl+C in a console does reach the handler on Windows;
  // only this programmatic path cannot express it.
  it.skipIf(process.platform === "win32")(
    "--no-open prints the URL, serves the API and exits on SIGINT",
    async () => {
      const temporary = createTemporaryDirectory();

      try {
        const init = runCli(["init"], temporary.path);
        expect(init.status).toBe(0);

        const child = spawn(
          process.execPath,
          [CLI_PATH, "watch", "--no-open"],
          {
            cwd: temporary.path,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );

        if (child.stdout === null) {
          throw new Error("expected the watch CLI to expose stdout");
        }

        const url = await waitForUrl(child.stdout);
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#\/board$/);

        const board = await fetch(url.replace("/#/board", "/api/board"));
        expect(board.status).toBe(200);
        expect(board.headers.get("content-type")).toContain("application/json");
        expect((await board.json()) as WatchBoard).toMatchObject({
          groups: {
            active: [],
            waiting: [],
            queued: [],
            done: [],
            cancelled: [],
          },
        });

        child.kill("SIGINT");
        const [exitCode] = await once(child, "exit");
        expect(exitCode).toBe(0);
      } finally {
        temporary.cleanup();
      }
    },
  );
});

function waitForUrl(stdout: Readable): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    const timer = setTimeout(
      () => reject(new Error("the watch URL was not printed in time")),
      10_000,
    );

    stdout.on("data", (chunk: string | Buffer) => {
      const match = /http:\/\/127\.0\.0\.1:\d+\/#\/board/.exec(String(chunk));

      if (match !== null) {
        clearTimeout(timer);
        resolveUrl(match[0]);
      }
    });
    stdout.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
