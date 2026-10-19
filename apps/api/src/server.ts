import "dotenv/config";
import mongoose from "mongoose";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { createLogger } from "./lib/logger.js";
import { Dataset } from "./models/tenant.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  if (config.auth.usedLegacySecretName) {
    logger.warn("JWT_SECRET is deprecated; rename it to JWT_ACCESS_SECRET in apps/api/.env");
  }
  if (!config.ml.url) logger.warn("ML_SERVICE_URL is not set: flows will be stored but stay unscored");

  mongoose.set("strictQuery", true);
  await mongoose.connect(config.mongoUri);
  logger.info({ host: mongoose.connection.host }, "MongoDB connected");

  // In-process imports do not survive a restart: report them honestly as failed.
  // Raw driver call: this system-wide cleanup is intentionally not org-scoped.
  const stale = await Dataset.collection.updateMany(
    { status: "Processing" },
    { $set: { status: "Failed", error: "Interrupted by an API restart; re-import the file", completedAt: new Date() } },
  );
  if (stale.modifiedCount) logger.warn({ count: stale.modifiedCount }, "Marked interrupted imports as failed");

  const { app, jobs } = createApp({ config, logger });
  const server = app.listen(config.port, () => logger.info({ port: config.port }, "Sentinel API listening"));
  // Large CICIDS2017 uploads (hundreds of MB) need time to arrive; parsing happens off the request.
  server.requestTimeout = 10 * 60 * 1000;

  const shutdown = (signal: string) => {
    logger.info({ signal, runningJobs: jobs.size }, "Shutting down");
    server.close(() => {
      void mongoose.disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  // The logger may not exist yet (bad config): print the reason without secrets.
  process.stderr.write(`[sentinel-api] Failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
