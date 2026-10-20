/**
 * Entry point for Vercel's Express preset: the default export is the handler.
 *
 * The application is built inside a try/catch on purpose. `createApp()` calls
 * `assertEnv()`, which raises a configuration problem before a single request is
 * handled, and on a serverless platform that would otherwise surface as an
 * opaque FUNCTION_INVOCATION_FAILED. Catching it turns a configuration mistake
 * into a 500 that names the problem.
 *
 * `require` rather than `import` so the load is synchronous and catchable here;
 * this package is CommonJS. There is deliberately no `listen` call - Vercel
 * owns the server, and `src/local.ts` is the entry for running one locally.
 */
import express, { type Express } from "express";
import { logger } from "./lib/logger";

let app: Express;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  app = (require("./app") as typeof import("./app")).createApp();
} catch (e) {
  const error = e instanceof Error ? e : new Error(String(e));
  logger.error("backend.init.failed", { message: error.message });

  app = express();
  app.use((_req, res) => {
    res.status(500).json({
      error: { code: "BACKEND_INIT_FAILED", message: error.message },
    });
  });
}

export default app;
