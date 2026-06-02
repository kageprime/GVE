import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { apiRouter } from "./routes/api.js";
import { initializeSessions } from "./state/session.js";
import { initializeTokenUsage } from "./state/token-usage.js";
import { conditionalClerkMiddleware } from "./lib/dev-auth.js";
import { runMigration } from "./db/migrate.js";

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many requests. Please try again shortly." },
  validate: { xForwardedForHeader: false }
});

export async function createApp(): Promise<express.Express> {
  runMigration();
  await initializeSessions();
  initializeTokenUsage();
  const app = express();
  app.set("trust proxy", 1);

  const isProd = process.env.NODE_ENV === "production";
  const corsOrigin = process.env.CORS_ORIGIN;
  /* In dev, default to reflecting the request origin so the frontend
     (localhost:5173) works without explicit CORS_ORIGIN config. */
  const origin = corsOrigin ?? (isProd ? false : true);
  app.use(cors({
    origin,
    credentials: Boolean(origin),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-user-id", "x-request-id"],
    maxAge: 86400
  }));

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  });

  app.use(conditionalClerkMiddleware());
  app.use("/api/", apiLimiter);
  app.use(express.json({ limit: "8mb" }));

  /* ─── Swagger Docs ─── */
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const swaggerDoc = YAML.parse(
    readFileSync(join(__dirname, "../docs/openapi.yaml"), "utf-8")
  );
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Visual Engine API",
  }));

  app.use("/", apiRouter);
  return app;
}