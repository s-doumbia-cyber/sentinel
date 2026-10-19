import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["development"] },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Each test file runs in its own process with its own in-memory MongoDB (see setup.ts).
    pool: "forks",
  },
});
