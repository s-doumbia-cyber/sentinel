import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { tmpdir } from "node:os";
import mongoose from "mongoose";
import { pinoHttp } from "pino-http";
import type { AppConfig } from "./config/index.js";
import { ah, requestId } from "./lib/http.js";
import { createJobQueue, type JobQueue } from "./lib/jobs.js";
import type { Logger } from "./lib/logger.js";
import { Metrics } from "./lib/metrics.js";
import { buildOpenApi, renderDocsPage } from "./lib/openapi.js";
import { PolicyRouter, type RouteInfo } from "./lib/routes.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { alertRoutes } from "./modules/alerts/alert.routes.js";
import { assetRoutes } from "./modules/assets/asset.routes.js";
import { identityRoutes } from "./modules/identity/identity.routes.js";
import { AlertService } from "./modules/alerts/alert.service.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { mfaRoutes } from "./modules/auth/mfa.routes.js";
import { MfaService } from "./modules/auth/mfa.service.js";
import { SecretBox } from "./lib/secrets.js";
import { datasetRoutes } from "./modules/datasets/dataset.routes.js";
import { flowRoutes } from "./modules/flows/flow.routes.js";
import { CorrelationService } from "./modules/incidents/correlation.service.js";
import { incidentRoutes } from "./modules/incidents/incident.routes.js";
import { incidentTraceRoutes } from "./modules/incidents/trace.routes.js";
import { detectionSettingsRoutes } from "./modules/rules/detection-settings.routes.js";
import { incidentWorkflowRoutes } from "./modules/incidents/workflow.routes.js";
import { recordDeadLetter, registerJobHandlers, type Scheduler } from "./modules/jobs/job.handlers.js";
import { jobRoutes } from "./modules/jobs/job.routes.js";
import { retentionRoutes } from "./modules/retention/retention.routes.js";
import { inviteRoutes } from "./modules/members/invite.routes.js";
import { memberRoutes } from "./modules/members/member.routes.js";
import { createMlClient, type MlClient } from "./modules/models/ml.client.js";
import { modelRoutes } from "./modules/models/model.routes.js";
import { ruleRoutes } from "./modules/rules/rule.routes.js";
import { RuleService } from "./modules/rules/rule.service.js";
import { ScoringService } from "./modules/scoring/scoring.service.js";
import { statsRoutes } from "./modules/stats/stats.routes.js";
import { validationRoutes } from "./modules/validation/validation.routes.js";

export const API_PREFIX = "/api/v1";
const API_VERSION = "0.1.0";

export interface AppOptions {
  config: AppConfig;
  logger: Logger;
  ml?: MlClient;
  authRateLimit?: { windowMs: number; max: number };
  /** Overrides the queue chosen from REDIS_URL (tests of the BullMQ path). */
  queue?: JobQueue;
}

export interface SentinelApp {
  app: Express;
  /** Background jobs; `jobs.idle()` waits for every queued job, `jobs.start()` starts BullMQ workers. */
  jobs: JobQueue;
  schedule: Scheduler;
  scoring: ScoringService;
  routes: RouteInfo[];
}

/** Builds the Express app without listening or connecting, so tests can drive it with supertest. */
export function createApp(options: AppOptions): SentinelApp {
  const { config, logger } = options;
  const app = express();
  const ml = options.ml ?? createMlClient(config);
  const alerts = new AlertService();
  const scoring = new ScoringService(ml, logger, alerts);
  const rules = new RuleService(alerts, logger);
  const correlation = new CorrelationService(logger);
  const queueMode = options.queue?.mode ?? (config.jobs.redisUrl ? "redis" : "in-process");
  const jobs =
    options.queue ??
    createJobQueue(
      { redisUrl: config.jobs.redisUrl, prefix: config.jobs.prefix, policy: { attempts: config.jobs.attempts, backoffMs: config.jobs.backoffMs } },
      logger,
      (entry) => recordDeadLetter(entry, queueMode),
    );
  const schedule = registerJobHandlers({ queue: jobs, logger, scoring, rules, correlation, canScore: Boolean(config.ml.url || options.ml) });

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(requestId());
  const metrics = config.metrics.enabled ? new Metrics() : null;
  if (metrics) app.use(metrics.middleware());
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
  // API answers carry tenant data and tokens: never stored by browsers or shared caches (ASVS 8.2.1).
  app.use(API_PREFIX, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
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
      const redis = await jobs.health();
      let mlStatus: "ok" | "unreachable" | "not_configured" = "not_configured";
      if (config.ml.url) {
        mlStatus = await fetch(`${config.ml.url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(2000) })
          .then((r) => (r.ok ? "ok" : "unreachable"))
          .catch(() => "unreachable");
      }
      // Redis down means queued work cannot be accepted: not ready. The ML service is optional.
      const ready = mongo && redis !== "down";
      res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "degraded", mongo: mongo ? "ok" : "down", redis, queue: jobs.mode, ml: mlStatus });
    }),
  );

  const routers: PolicyRouter[] = [
    health,
    authRoutes(config, { authRateLimit: options.authRateLimit ?? { windowMs: 15 * 60 * 1000, max: 20 } }),
    mfaRoutes(config, {
      mfa: new MfaService(new SecretBox(config.encryption.key)),
      rateLimit: options.authRateLimit ?? { windowMs: 15 * 60 * 1000, max: 20 },
    }),
    flowRoutes(config),
    statsRoutes(config, { requestRollup: schedule.rollup }),
    datasetRoutes(config, { schedule, uploadDir: config.uploadDir ?? tmpdir() }),
    incidentRoutes(config),
    incidentWorkflowRoutes(config),
    incidentTraceRoutes(config),
    detectionSettingsRoutes(config),
    memberRoutes(config),
    inviteRoutes(config, { rateLimit: options.authRateLimit ?? { windowMs: 15 * 60 * 1000, max: 20 } }),
    auditRoutes(config),
    modelRoutes(config, { ml, scoring, scheduleScoring: schedule.score, scoringBusy: (orgId) => schedule.busy("score", orgId) }),
    alertRoutes(config),
    ruleRoutes(config, { rules, scheduleDetections: schedule.detect }),
    assetRoutes(config, { scheduleAssetRefresh: schedule.assets }),
    identityRoutes(config),
    validationRoutes(config, { ml }),
    jobRoutes(config, { queue: jobs }),
    retentionRoutes(config, { schedule }),
  ];
  for (const r of routers) app.use(API_PREFIX, r.router);
  const routes = routers.flatMap((r) => r.routes.map((x) => ({ ...x, path: `${API_PREFIX}${x.path}` })));

  // API reference generated from the same route policies and zod schemas the API enforces.
  const openapi = buildOpenApi(routes, { version: API_VERSION });
  app.get("/api/docs/openapi.json", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.json(openapi);
  });
  app.get("/api/docs", (_req, res) => {
    const nonce = randomBytes(16).toString("base64");
    res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    res.type("html").send(renderDocsPage(openapi, nonce));
  });

  if (metrics) {
    const expected = config.metrics.token ? Buffer.from(`Bearer ${config.metrics.token}`) : null;
    app.get("/metrics", (req, res, next) => {
      if (expected) {
        const given = Buffer.from(req.header("authorization") ?? "");
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
          res.status(401).type("text/plain").send("unauthorized");
          return;
        }
      }
      metrics
        .render({ queue: jobs, mongoUp: mongoose.connection.readyState === 1 })
        .then((text) => res.type("text/plain; version=0.0.4").send(text))
        .catch(next);
    });
  }

  app.use(notFound);
  app.use(errorHandler(logger));

  return { app, jobs, schedule, scoring, routes };
}
