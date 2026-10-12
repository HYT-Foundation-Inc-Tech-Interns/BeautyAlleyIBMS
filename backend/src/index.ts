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

function shutdown(signal: string) {
  logger.info("server.shutdown", { signal });
  server.close(() => process.exit(0));
  // Do not hang forever on a stuck keep-alive connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
