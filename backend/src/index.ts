/**
 * Entry point.
 *
 * On Vercel this module is imported and its default export - an Express app -
 * becomes the function handler. Locally it also starts a listener, so
 * `npm run dev` still behaves like a normal server.
 *
 * The application is built lazily and any failure to build it is returned as a
 * readable 500. The alternative on a serverless platform is an opaque
 * FUNCTION_INVOCATION_FAILED, which says nothing about what is actually wrong;
 * a misconfigured deployment (a missing SUPABASE_URL, say) should say so.
 */
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { logger } from "./lib/logger";

let app: Express | null = null;
let failure: Error | null = null;

async function load(): Promise<Express> {
  if (app) return app;
  if (failure) throw failure;
  try {
    // Imported dynamically so a throw while the module graph loads (env
    // validation, the Supabase client) is catchable here.
    const mod = await import("./app");
    app = mod.createApp();
    return app;
  } catch (e) {
    failure = e instanceof Error ? e : new Error(String(e));
    throw failure;
  }
}

const server = express();

server.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    (await load())(req, res, next);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("backend.init.failed", { message });
    res.status(500).json({ error: { code: "BACKEND_INIT_FAILED", message } });
  }
});

export default server;

// Vercel manages its own server and sets VERCEL=1; everywhere else, listen.
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT ?? 4000);
  const listener = server.listen(port, () => {
    logger.info("server.started", { port, env: process.env.NODE_ENV });
  });

  function shutdown(signal: string) {
    logger.info("server.shutdown", { signal });
    listener.close(() => process.exit(0));
    // Do not hang forever on a stuck keep-alive connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
