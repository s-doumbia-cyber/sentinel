import "dotenv/config";
import mongoose from "mongoose";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { createLogger } from "./lib/logger.js";

/**
 * Worker-only entry point: runs the BullMQ workers without serving HTTP, so the
 * API can run with RUN_WORKERS=false and scale separately. Uploads must be on a
 * directory both processes see (UPLOAD_DIR).
 */
async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  if (!config.jobs.redisUrl) throw new Error("The worker needs REDIS_URL (without it, jobs run inside the API process)");
  mongoose.set("strictQuery", true);
  await mongoose.connect(config.mongoUri);
  const { jobs } = createApp({ config, logger });
  await jobs.start();
  logger.info({ prefix: config.jobs.prefix }, "Sentinel worker started");

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Worker shutting down");
    void jobs
      .close()
      .catch(() => undefined)
      .then(() => mongoose.disconnect())
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 30_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  process.stderr.write(`[sentinel-worker] Failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
