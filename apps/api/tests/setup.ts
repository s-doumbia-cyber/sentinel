import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll } from "vitest";

// Real MongoDB in-process: tests exercise actual queries and aggregations and
// never touch a developer database.
let mongod: MongoMemoryServer | undefined;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // For tests that start a second process against the same throwaway database.
  process.env.SENTINEL_TEST_MONGO_URI = mongod.getUri();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

afterEach(async () => {
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});
