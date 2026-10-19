import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // Defaults to localhost for local `npm run dev`; in docker-compose,
        // the frontend container reaches the backend by service name, not
        // localhost, so that setup overrides this via VITE_API_PROXY_TARGET.
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
