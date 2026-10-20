import { createApp } from "./app";
import { env, hasServiceRoleKey } from "./config/env";
import { logger } from "./lib/logger";

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info("server.started", { port: env.port, env: env.nodeEnv });

  // Said out loud at boot rather than discovered on the first 503. Half the
  // API is unusable without this key, and the failure would otherwise surface
  // as an opaque error much later.
  if (!hasServiceRoleKey) {
    logger.warn(
      "SUPABASE_SERVICE_ROLE_KEY is not set - authenticated and write endpoints will return 503. " +
        "Add it to backend/.env and restart."
    );
  }
});

function shutdown(reason: string, code = 0) {
  logger.info("server.shutdown", { reason, code });
  server.close(() => process.exit(code));
  // Do not hang forever on a stuck keep-alive connection.
  setTimeout(() => process.exit(code || 1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

/**
 * Process-level failures.
 *
 * Node 20 already exits on an unhandled rejection or an uncaught exception, but
 * it does so silently - no final log line, no flush, no chance to see what
 * happened. These handlers keep the same outcome (a non-zero exit, so a
 * supervisor restarts) while recording the cause first.
 *
 * They deliberately do not swallow the error and keep running: after an
 * uncaught exception the process is in an unknown state, and a web server that
 * continues in an unknown state is worse than one that restarts.
 */
process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandledRejection", { reason });
  shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (err) => {
  logger.error("process.uncaughtException", { err });
  shutdown("uncaughtException", 1);
});
