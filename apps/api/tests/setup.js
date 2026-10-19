import { afterAll, afterEach, beforeAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import "dotenv/config";

// Shared across every test file (see vitest.config.js's singleFork pool):
// spins up one real, in-process MongoDB instance so tests exercise actual
// Mongoose queries/aggregations rather than mocks, without touching the
// developer's real cyber_threat_dashboard database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-for-production";

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});
