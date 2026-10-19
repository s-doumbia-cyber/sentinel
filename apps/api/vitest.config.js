import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.js"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run all test files in a single process/thread: they share one
    // mongodb-memory-server instance (started once in setup.js) rather than
    // each spawning its own, which is both faster and lighter on a laptop.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
