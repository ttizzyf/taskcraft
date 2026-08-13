// Playwright config for the watch frontend smoke suite. The suite starts a
// real watch server over fixture-backed temp stores, so it is excluded from
// the vitest run (vitest includes tests/**/*.test.ts only) and from
// `pnpm check`; run it explicitly with: pnpm smoke:watch

import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "tests/watch",
  testMatch: "frontend.spec.ts",
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
  },
});
