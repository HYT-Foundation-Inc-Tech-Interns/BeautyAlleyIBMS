/**
 * Jest globalSetup - runs once, before any test file.
 *
 * Seeds the database so every suite starts from the same known state. Doing it
 * here rather than in a per-file `beforeAll` is deliberate: the seed truncates,
 * so running it per-file would wipe data a previously-run suite is still
 * asserting against when jest runs files in band.
 */
import path from "path";
import dotenv from "dotenv";

export default async function globalSetup() {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });

  if (!process.env.DATABASE_URL) {
    // Not fatal: the unit suite does not need a database.
    // eslint-disable-next-line no-console
    console.warn("[globalSetup] DATABASE_URL not set - skipping seed");
    return;
  }

  // scripts/seed.js is CommonJS and takes a pg Client.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Client } = require("pg");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { seed } = require("../scripts/seed.js");

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await seed(client, { quiet: true });
    // eslint-disable-next-line no-console
    console.log("[globalSetup] database seeded");
  } finally {
    await client.end();
  }
}
