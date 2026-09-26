// Host launch spec: the seam that lets tc start `codex`/`claude` on Windows.
// POSIX launches the command directly. Windows cannot CreateProcess npm's
// `.cmd` shims (EINVAL) and a bare name resolves to the extensionless POSIX
// shim (ENOENT), so the command is routed through `cmd.exe /d /s /c` with
// verbatim arguments — which only works if every argument is quoted for
// cmd.exe first. The platform is injected so both branches are asserted from
// either host.
//
// The same seam owns termination. Routing through cmd.exe inserts a hop, so
// the process Node knows about is not the host: killing only the direct child
// leaves the host running. terminateTree therefore has to take down the whole
// tree, and that is asserted against real processes below rather than a fake.

import { once } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  commandSpec,
  spawnCommand,
  terminateTree,
} from "../../src/adapters/process.js";
import { createTemporaryDirectory } from "../helpers/temp-directory.js";

const COMSPEC = process.env.ComSpec ?? "cmd.exe";

/** Time the grandchild waits before dropping its marker file. */
const MARKER_DELAY_MS = 3_000;
/** Time the intermediate hop needs to start the grandchild before we kill. */
const SPAWN_SETTLE_MS = 800;

/** A host-shaped process: it spawns a grandchild and then keeps running, so it
 * only disappears if the whole tree is terminated. */
const TREE_SOURCE = `
const { spawn } = require("node:child_process");
spawn(process.execPath, [process.argv[3], process.argv[2]], { stdio: "ignore" });
setInterval(() => {}, 1000);
`;

/** The grandchild: drops a marker file after a delay. A surviving marker means
 * the grandchild outlived the kill. */
const GRANDCHILD_SOURCE = `
const { writeFileSync } = require("node:fs");
setTimeout(() => {
  try { writeFileSync(process.argv[2], "alive"); } catch {}
}, ${String(MARKER_DELAY_MS)});
`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("commandSpec", () => {
  it("launches the command directly on POSIX", () => {
    const spec = commandSpec(
      "claude",
      ["-p", "Reply exactly TC_FIRST."],
      "darwin",
    );

    expect(spec.file).toBe("claude");
    expect(spec.args).toEqual(["-p", "Reply exactly TC_FIRST."]);
    expect(spec.verbatim).toBe(false);
  });

  it("routes Windows through cmd.exe with verbatim arguments", () => {
    const spec = commandSpec("claude", ["--version"], "win32");

    expect(spec.file).toBe(COMSPEC);
    expect(spec.args).toEqual(["/d", "/s", "/c", "claude --version"]);
    expect(spec.verbatim).toBe(true);
  });

  it("quotes a spaced prompt so cmd.exe keeps it as one argument", () => {
    const spec = commandSpec(
      "claude",
      ["-p", "--include-hook-events", "Reply exactly TC_FIRST."],
      "win32",
    );

    expect(spec.args[3]).toBe(
      'claude -p --include-hook-events "Reply exactly TC_FIRST."',
    );
  });

  it("keeps an empty argument, which cmd.exe would otherwise drop", () => {
    const spec = commandSpec(
      "claude",
      ["--tools", "", "--model", "sonnet"],
      "win32",
    );

    // An unquoted empty argument disappears and shifts every later flag.
    expect(spec.args[3]).toBe('claude --tools "" --model sonnet');
  });

  it("escapes an embedded quote instead of ending the quoted run", () => {
    const spec = commandSpec("codex", ["--prompt", 'say "hi" now'], "win32");

    expect(spec.args[3]).toBe('codex --prompt "say \\"hi\\" now"');
  });

  it("leaves cmd.exe metacharacters quoted so they cannot be interpreted", () => {
    const spec = commandSpec("codex", ["a&b", "c|d", "e>f"], "win32");

    expect(spec.args[3]).toBe('codex "a&b" "c|d" "e>f"');
  });
});

describe("terminateTree", () => {
  it("ignores a missing pid instead of throwing", () => {
    expect(() => {
      terminateTree(undefined, true);
    }).not.toThrow();
  });

  it("kills the descendants, not only the direct child", async () => {
    const directory = createTemporaryDirectory();
    const marker = join(directory.path, "marker.txt");
    const tree = join(directory.path, "tree.cjs");
    const grandchild = join(directory.path, "grandchild.cjs");

    try {
      writeFileSync(tree, TREE_SOURCE, "utf8");
      writeFileSync(grandchild, GRANDCHILD_SOURCE, "utf8");

      // On Windows this is cmd.exe -> node(tree) -> node(grandchild); the
      // process that writes the marker is two hops below the one Node spawned.
      const child = spawnCommand(process.execPath, [tree, marker, grandchild], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      await delay(SPAWN_SETTLE_MS);
      terminateTree(child.pid, true);
      await once(child, "close");

      await delay(MARKER_DELAY_MS);
      expect(existsSync(marker)).toBe(false);
    } finally {
      directory.cleanup();
    }
  });
});
