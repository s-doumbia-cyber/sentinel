import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import mongoose, { type Types } from "mongoose";
import { pinoHttp } from "pino-http";
import type { AppConfig } from "./config/index.js";
import { ah, requestId } from "./lib/http.js";
import { BackgroundJobs } from "./lib/jobs.js";
import type { Logger } from "./lib/logger.js";
import { PolicyRouter, type RouteInfo } from "./lib/routes.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { datasetRoutes } from "./modules/datasets/dataset.routes.js";
import { flowRoutes } from "./modules/flows/flow.routes.js";
import { incidentRoutes } from "./modules/incidents/incident.routes.js";
import { memberRoutes } from "./modules/members/member.routes.js";
import { createMlClient, type MlClient } from "./modules/models/ml.client.js";
import { modelRoutes } from "./modules/models/model.routes.js";
import { ScoringService } from "./modules/scoring/scoring.service.js";
import { statsRoutes } from "./modules/stats/stats.routes.js";

export const API_PREFIX = "/api/v1";

export interface AppOptions {
  config: AppConfig;
  logger: Logger;
  ml?: MlClient;
  authRateLimit?: { windowMs: number; max: number };
}

export interface SentinelApp {
  app: Express;
  jobs: BackgroundJobs;
  scoring: ScoringService;
  routes: RouteInfo[];
}

/** Builds the Express app without listening or connecting, so tests can drive it with supertest. */
export function createApp(options: AppOptions): SentinelApp {
  const { config, logger } = options;
  const app = express();
  const jobs = new BackgroundJobs(logger);
  const ml = options.ml ?? createMlClient(config);
  const scoring = new ScoringService(ml, logger);
  const scheduleScoring = (orgId: Types.ObjectId) => {
    if (!config.ml.url && !options.ml) return;
    jobs.run(`score:${String(orgId)}`, () => scoring.scorePending(orgId));
  };

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(requestId());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as unknown as { id: string }).id,
      customProps: (req) => ({ orgId: (req as express.Request).auth ? String((req as express.Request).auth?.orgId) : undefined }),
      autoLogging: { ignore: (req) => req.url?.endsWith("/healthz") ?? false },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-origin" },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "X-Org-Id", "X-Request-Id", "X-Sentinel-CSRF"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    API_PREFIX,
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: config.isTest ? 100_000 : 2_000,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests", requestId: req.id } });
      },
    }),
  );

  const health = new PolicyRouter(config);
  health.route("get", "/healthz", "public", (_req, res) => {
    res.json({ status: "ok" });
  });
  health.route(
    "get",
    "/readyz",
    "public",
    ah(async (_req, res) => {
      const mongo = mongoose.connection.readyState === 1;
      let mlStatus: "ok" | "unreachable" | "not_configured" = "not_configured";
      if (config.ml.url) {
        mlStatus = await fetch(`${config.ml.url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(2000) })
          .then((r) => (r.ok ? "ok" : "unreachable"))
          .catch(() => "unreachable");
      }
      res.status(mongo ? 200 : 503).json({ status: mongo ? "ok" : "degraded", mongo: mongo ? "ok" : "down", ml: mlStatus });
    }),
  );

  const routers: PolicyRouter[] = [
    health,
    authRoutes(config, { authRateLimit: options.authRateLimit ?? { windowMs: 15 * 60 * 1000, max: 20 } }),
    flowRoutes(config),
    statsRoutes(config),
    datasetRoutes(config, { jobs, logger, onImported: scheduleScoring }),
    incidentRoutes(config),
    memberRoutes(config),
    auditRoutes(config),
    modelRoutes(config, { ml, scoring, scheduleScoring }),
  ];
  for (const r of routers) app.use(API_PREFIX, r.router);

  app.use(notFound);
  app.use(errorHandler(logger));

  return { app, jobs, scoring, routes: routers.flatMap((r) => r.routes.map((x) => ({ ...x, path: `${API_PREFIX}${x.path}` }))) };
}
