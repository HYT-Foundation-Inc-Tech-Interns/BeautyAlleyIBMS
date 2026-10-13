/**
 * Local development entry. Starts a real listener.
 *
 * Kept out of `index.ts` so the Vercel entry is nothing but a default export:
 * the platform manages its own server, and a stray `listen` in that module
 * only invites the preset to guess at what it should do.
 */
import app from "./index";
import { env } from "./config/env";
import { logger } from "./lib/logger";

const listener = app.listen(env.port, () => {
  logger.info("server.started", { port: env.port, env: env.nodeEnv });
});

function shutdown(signal: string) {
  logger.info("server.shutdown", { signal });
  listener.close(() => process.exit(0));
  // Do not hang forever on a stuck keep-alive connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
