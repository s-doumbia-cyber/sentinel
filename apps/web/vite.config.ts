import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Use the shared package's TypeScript sources directly (types, taxonomy, schemas).
      "@sentinel/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Same-origin API calls keep the refresh cookie first-party (SameSite=Strict).
      "/api": { target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000", changeOrigin: false },
    },
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 700 },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
