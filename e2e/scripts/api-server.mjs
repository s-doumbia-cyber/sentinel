#!/usr/bin/env node
// Starts a throwaway API for the e2e suite: an in-memory MongoDB (random port, deleted on exit)
// and the API from source. Playwright launches it as a web server and stops it after the run.
//
// Safety: the API runs with this folder as its working directory and DOTENV_CONFIG_PATH pointing
// at a file that does not exist, so apps/api/.env is never loaded and the developer database is
// never reachable. No ML service is configured: flows stay unscored and detection relies on rules.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server";

const require = createRequire(import.meta.url);
const port = process.env.E2E_API_PORT ?? "4310";
const webOrigin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:5310";
const e2eDir = fileURLToPath(new URL("..", import.meta.url));
const serverEntry = fileURLToPath(new URL("../../apps/api/src/server.ts", import.meta.url));
const tsxCli = require.resolve("tsx/cli");

const mongod = await MongoMemoryServer.create();
const api = spawn(process.execPath, [tsxCli, "--conditions=development", serverEntry], {
  cwd: e2eDir,
  stdio: "inherit",
  env: {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    DOTENV_CONFIG_PATH: fileURLToPath(new URL("../.no-env", import.meta.url)),
    NODE_ENV: "development",
    PORT: port,
    LOG_LEVEL: "warn",
    MONGO_URI: mongod.getUri("sentinel_e2e"),
    JWT_ACCESS_SECRET: randomBytes(48).toString("base64url"),
    CORS_ORIGINS: webOrigin,
  },
});

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  api.kill();
  await mongod.stop().catch(() => undefined);
  process.exit(code);
}
api.on("exit", (code) => void stop(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => void stop(0));
