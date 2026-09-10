import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "evals/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    restoreMocks: true,
  },
});
