import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * Captures the README screenshots on the same throwaway stack as the e2e suite (in-memory MongoDB,
 * synthetic DEMO scenario, no ML service). Run with `npm run docs:screenshots`; output goes to
 * docs/screenshots/. Not part of `test:e2e`.
 */
export default defineConfig({
  ...base,
  testDir: "./screenshots",
  projects: [{ name: "screenshots", use: { browserName: "chromium", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light" } }],
  reporter: [["list"]],
});
