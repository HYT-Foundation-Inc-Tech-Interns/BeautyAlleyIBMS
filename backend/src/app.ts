import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { env, hasServiceRoleKey } from "./config/env";
import { apiRouter } from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { apiLimiter } from "./middleware/rateLimit";
import { requireServiceRole } from "./db/supabase";
import { logger } from "./lib/logger";
import { buildApiIndex } from "./lib/apiIndex";

export function createApp() {
  const app = express();

  // Behind a load balancer, `req.ip` is the proxy's address unless Express is
  // told to read X-Forwarded-For. That matters here because the login limiter
  // keys on it: with this off, every request looks like it came from the same
  // place and the limiter locks out the whole world at once.
  //
  // Set to 1 (trust exactly one hop) rather than `true`, which would trust a
  // client-supplied X-Forwarded-For and let anyone forge their own IP.
  app.set("trust proxy", 1);

  app.disable("x-powered-by");

  app.use(
    helmet({
      // This is a JSON API with no HTML surface, so the browser-facing
      // policies helmet defaults to are noise. The ones that matter -
      // nosniff, frameguard, HSTS - are kept.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  app.use(
    cors({
      // `true` reflects the request origin. Appropriate while the front end is
      // served from a different port in development; pin this to an explicit
      // allow-list before this is exposed publicly.
      origin: true,
      credentials: true,
      exposedHeaders: ["Content-Disposition"],
    })
  );

  // A 100kb body cap. The largest legitimate payload is a booking with a
  // handful of service ids - anything bigger is a mistake or an attack.
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));

  app.use(apiLimiter);

  // Request logging. The logger redacts credentials, so this cannot leak the
  // bearer token in the Authorization header.
  app.use((req: Request, res: Response, next) => {
    const started = Date.now();
    res.on("finish", () => {
      logger.debug("http.request", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - started,
      });
    });
    next();
  });

  /**
   * Liveness + readiness in one.
   *
   * It reports whether the service-role key is present, because a deployment
   * that is up but cannot reach the database would otherwise look healthy
   * right up until the first booking attempt.
   */
  app.get("/health", async (_req: Request, res: Response) => {
    const checks: Record<string, unknown> = {
      serviceRoleKey: hasServiceRoleKey,
      timezone: env.branchTimezone,
    };

    let ok = true;
    if (hasServiceRoleKey) {
      try {
        const db = requireServiceRole();
        const { error } = await db.from("services").select("id", { head: true, count: "exact" }).limit(1);
        checks.database = error ? "error" : "ok";
        if (error) ok = false;
      } catch {
        checks.database = "error";
        ok = false;
      }
    } else {
      checks.database = "unconfigured";
    }

    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      env: env.nodeEnv,
      checks,
    });
  });

  /**
   * Service index.
   *
   * The root of a backend-only service is otherwise a dead end: a browser
   * pointed at the port gets a bare `NOT_FOUND`, which reads as "broken" when
   * the service is healthy and simply has no page there. This is JSON, not
   * HTML - the brief is backend-only, and a landing page would put a
   * browser-facing surface on a service that is not meant to have one.
   */
  app.get("/", (_req: Request, res: Response) => {
    res.status(200).json({ data: buildApiIndex() });
  });

  app.use("/api/v1", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
