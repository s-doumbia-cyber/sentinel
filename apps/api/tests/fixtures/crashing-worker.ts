/**
 * Test fixture (not shipped): a BullMQ worker process that kills itself with SIGKILL
 * in the middle of settling alert evidence, after the alert was updated and before
 * the flows are marked. Used by jobs.redis.test.ts to prove a stalled job is taken
 * over by another worker without losing or double-counting evidence.
 */
import mongoose from "mongoose";
import { createApp } from "../../src/app.js";
import { RedisJobQueue } from "../../src/lib/jobs.js";
import { createLogger } from "../../src/lib/logger.js";
import { Flow } from "../../src/models/tenant.js";
import { recordDeadLetter } from "../../src/modules/jobs/job.handlers.js";
import { FakeMl, testConfig } from "../helpers.js";

const { SENTINEL_TEST_MONGO_URI: mongoUri, SENTINEL_TEST_REDIS_URL: redisUrl, SENTINEL_TEST_PREFIX: prefix } = process.env;
if (!mongoUri || !redisUrl || !prefix) throw new Error("crashing-worker needs SENTINEL_TEST_MONGO_URI, SENTINEL_TEST_REDIS_URL and SENTINEL_TEST_PREFIX");

await mongoose.connect(mongoUri);
const logger = createLogger("silent");
const queue = new RedisJobQueue(redisUrl, prefix, { attempts: 3, backoffMs: 10 }, logger, (e) => recordDeadLetter(e, "redis"), {
  lockDurationMs: 2000,
  stalledIntervalMs: 1000,
});
createApp({ config: testConfig({ ML_SERVICE_URL: "http://ml.test" }), logger, ml: new FakeMl(), queue });

const original = Flow.updateMany.bind(Flow);
Flow.updateMany = ((...args: Parameters<typeof Flow.updateMany>) => {
  const update = args[1] as { $unset?: Record<string, unknown> } | undefined;
  // The alert already holds this evidence; the flows are not marked yet. Die like `kill -9`.
  if (update?.$unset?.alertClaimedAt) process.kill(process.pid, "SIGKILL");
  return original(...args);
}) as typeof Flow.updateMany;

await queue.start();
process.stdout.write("READY\n");
