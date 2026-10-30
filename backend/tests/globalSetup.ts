/**
 * Jest globalSetup - runs once, before any test file.
 *
 * Seeds the database so every suite starts from the same known state. Doing it
 * here rather than in a per-file `beforeAll` is deliberate: the seed truncates,
 * so running it per-file would wipe data a previously-run suite is still
 * asserting against when jest runs files in band.
 */
import { assertSeparateDatabase, isUnitOnlyRun, loadTestEnv } from "./env";
import { acquireRunLock } from "./helpers/runLock";

export default async function globalSetup() {
  // .env.test.local first, then .env.local: a test project wins, so the suite
  // can run against its own database without touching the application's
  // configuration. See tests/env.ts.
  loadTestEnv();

  /*
   * The unit suite touches no database, so it runs anywhere. The teardown asks
   * the same question, so it can skip its write too - see isUnitOnlyRun.
   */
  if (isUnitOnlyRun()) return;

  if (!process.env.DATABASE_URL) {
    // Not fatal: the unit suite does not need a database.
    // eslint-disable-next-line no-console
    console.warn("[globalSetup] DATABASE_URL not set - skipping seed");
    return;
  }

  /*
   * Everything below this line TRUNCATEs seventeen tables. The target has to be
   * a database the application does not use - a test run against the app's own
   * project deletes every client, booking and employee in it, which reads as
   * "the app is not saving anything". See tests/env.ts.
   */
  assertSeparateDatabase();

  // Refuse to start when another run is live. Two concurrent runs share this
  // database and the seed below TRUNCATEs it, so the second run corrupts the
  // first one's fixtures. See tests/helpers/runLock.ts.
  acquireRunLock();

  // scripts/seed.js is CommonJS and takes a pg Client.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Client } = require("pg");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { seed, databaseHost } = require("../scripts/seed.js");

  // Say out loud which database is about to be truncated. The seed guard
  // refuses NODE_ENV=production, but a test run pointed at the wrong hosted
  // project is the realistic accident, and this line is how it gets noticed.
  // eslint-disable-next-line no-console
  console.log(`[globalSetup] seeding ${databaseHost()}`);

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    // `confirmed: true` because assertSeparateDatabase() above *is* the
    // confirmation: it proved this target is not the application's database,
    // which is a stronger statement than a flag sitting in a file. Without it
    // the suite would need ALLOW_DESTRUCTIVE_SEED=1 - the exact flag whose
    // presence in .env.local caused the incident.
    await seed(client, { quiet: true, confirmed: true });
    // eslint-disable-next-line no-console
    console.log("[globalSetup] database seeded");
  } finally {
    await client.end();
  }
}
