import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { API_PORT, API_URL, WEB_PORT, WEB_URL } from "./tests/env";

export default defineConfig({
  testDir: "./tests",
  // One API process with in-process background jobs: run files one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: false }, testMatch: /mobile\.spec\.ts/ },
  ],
  // Never reuse a running server: an existing one could be connected to a developer database.
  webServer: [
    {
      command: "node scripts/api-server.mjs",
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      url: `${API_URL}/readyz`,
      reuseExistingServer: false,
      timeout: 120_000,
      // API request logs are noise here; startup failures still reach stderr.
      stdout: "ignore",
      stderr: "pipe",
      env: { E2E_API_PORT: String(API_PORT), E2E_WEB_ORIGIN: WEB_URL },
    },
    {
      command: `node ../../node_modules/vite/bin/vite.js --port ${WEB_PORT} --strictPort`,
      cwd: fileURLToPath(new URL("../apps/web", import.meta.url)),
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
