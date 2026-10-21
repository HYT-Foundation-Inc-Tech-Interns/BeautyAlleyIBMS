/**
 * Entry point for Vercel's Express preset.
 *
 * ## Why `export =` and not `export default`
 *
 * This package is CommonJS - `backend/package.json` has no `"type"` field - and
 * the preset finds the app by module shape: in a CommonJS package it looks for
 * `module.exports = app`. `export default app` compiles to
 * `exports.default = app`, which the preset does not recognise, so the function
 * deploys with nothing to invoke and every request answers with the platform's
 * opaque `FUNCTION_INVOCATION_FAILED` - no route matched, no log line from this
 * process, and not even the `x-request-id` header this app sets on every
 * response. `export =` is TypeScript's spelling of `module.exports = app`.
 *
 * The preset also sniffs a fixed set of filenames (`app`, `index`, `server`, at
 * the root or under `src/`) and treats the first one that imports express as
 * the entry. That is why the factory lives in `createApp.ts` rather than
 * `app.ts`: a second express-importing candidate beside this file is a coin
 * flip, and the losing side has no default export to hand over.
 *
 * ## Why the app is built inside a try/catch
 *
 * `createApp()` calls `assertEnv()`, which raises a configuration problem before
 * a single request is handled, and on a serverless platform that would
 * otherwise surface as another opaque `FUNCTION_INVOCATION_FAILED`. Catching it
 * turns a configuration mistake into a 500 that names the problem.
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
  app = (require("./createApp") as typeof import("./createApp")).createApp();
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

export = app;
