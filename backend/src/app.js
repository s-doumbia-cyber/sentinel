import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/authRoutes.js";
import flowRoutes from "./routes/flowRoutes.js";
import incidentRoutes from "./routes/incidentRoutes.js";
import datasetRoutes from "./routes/datasetRoutes.js";
import mlRoutes from "./routes/mlRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";

// Builds the configured Express app without starting a listener or
// connecting to MongoDB — split out from server.js so tests (see /tests)
// can exercise real routes with supertest against an in-memory database,
// without needing a real network port or a real MongoDB deployment.
export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173", credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  if (process.env.NODE_ENV !== "test") {
    app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
  }

  // Basic API-wide rate limiting; auth routes get a stricter limiter applied
  // separately in production hardening (see docs/03-api-and-schema.md).
  app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

  app.get("/api/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

  app.use("/api/auth", authRoutes);
  app.use("/api/flows", flowRoutes);
  app.use("/api/incidents", incidentRoutes);
  app.use("/api/datasets", datasetRoutes);
  app.use("/api/ml", mlRoutes);
  app.use("/api/users", userRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
