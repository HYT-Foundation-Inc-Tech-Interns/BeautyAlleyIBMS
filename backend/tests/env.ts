import fs from "fs";
import path from "path";
import dotenv from "dotenv";

/**
 * Which database the test suite is allowed to touch.
 *
 * ## Why this exists
 *
 * `globalSetup` seeds the database, and seeding TRUNCATEs seventeen tables.
 * The suite pointed at whatever `DATABASE_URL` said, which in this checkout was
 * the application's own Supabase project - so every `npm test` deleted every
 * client, booking, employee, task and attendance row the branch had entered,
 * and rebuilt the three demo stylists. The data loss looks like "the app is not
 * saving anything", because it is: it was saved, then truncated by a test run.
 *
 * `ALLOW_DESTRUCTIVE_SEED=1` in `.env.local` was the other half: the seed's own
 * guard asks "is this database disposable?" and that flag answered yes on
 * behalf of the production database.
 *
 * ## The rule
 *
 * A test run needs a database that is *declared separate* from the one the
 * application uses. Point `.env.test.local` at a second Supabase project:
 *
 *     SUPABASE_URL=...
 *     SUPABASE_ANON_KEY=...
 *     SUPABASE_SERVICE_ROLE_KEY=...
 *     DATABASE_URL=postgresql://...
 *
 * The suite loads that file first, so it wins over `.env.local`. If it is
 * missing, the run stops here instead of truncating the application's data.
 */

const ROOT = path.join(__dirname, "..");

/** First file to define a key wins; dotenv never overwrites. */
const ENV_FILES = [".env.test.local", ".env.test", ".env.local", ".env"].map((f) =>
  path.join(ROOT, f)
);

export function loadTestEnv(): void {
  dotenv.config({ path: ENV_FILES });
}

/**
 * The database `.env.local` points at - i.e. the one the application itself
 * uses. Read with `dotenv.parse` rather than from `process.env`, because by now
 * the test file may already have overridden it.
 */
export function appDatabaseUrl(): string | null {
  try {
    const parsed = dotenv.parse(fs.readFileSync(path.join(ROOT, ".env.local")));
    return parsed.DATABASE_URL ?? null;
  } catch {
    return null;
  }
}

/** Host and database name, ignoring credentials and query string. */
function target(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * True when both urls address the same database.
 *
 * Pure, so it can be tested without a database - see
 * tests/unit/testDatabase.test.ts. An unparseable url is treated as *equal*:
 * refusing to run is the safe answer when the target cannot be identified.
 */
export function isSameDatabase(a: string, b: string): boolean {
  const ta = target(a);
  const tb = target(b);
  if (!ta || !tb) return true;
  return ta === tb;
}

/**
 * Refuse to seed the application's database.
 *
 * Returns the url the suite should use, so callers cannot accidentally read
 * `process.env.DATABASE_URL` again after the check and get a different answer.
 */
export function assertSeparateDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The integration suite runs against a real Postgres:\n" +
        "copy backend/.env.example to backend/.env.test.local and fill it in with a\n" +
        "database that is NOT the one the application uses."
    );
  }

  const app = appDatabaseUrl();
  if (app && isSameDatabase(url, app)) {
    const host = target(url) ?? "(unparseable DATABASE_URL)";
    throw new Error(
      `Refusing to run: the tests would seed ${host}, which is the database\n` +
        "backend/.env.local points at - the one the application uses.\n\n" +
        "globalSetup TRUNCATEs seventeen tables before every run, so this would\n" +
        "delete every client, booking, employee, task and attendance row in it.\n\n" +
        "Create backend/.env.test.local pointing at a second Supabase project:\n" +
        "  SUPABASE_URL=...\n" +
        "  SUPABASE_ANON_KEY=...\n" +
        "  SUPABASE_SERVICE_ROLE_KEY=...\n" +
        "  DATABASE_URL=postgresql://...\n\n" +
        "Run the unit suite with 'npm run test:unit' - it needs no database."
    );
  }

  return url;
}
