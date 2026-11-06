/**
 * Loads environment variables for the standalone scripts.
 *
 * Normal mode: `backend/.env.local` (the real credentials, gitignored) is read
 * first and wins; `backend/.env` (tracked, placeholders only) fills in anything
 * the local file does not define. dotenv keeps the first value it sees for a
 * key, so .env.local always overrides .env.
 *
 * Test mode (`--test`, or NODE_ENV=test): `backend/.env.test.local` must exist
 * and must define DATABASE_URL. It is loaded first, and there is deliberately
 * no silent fallback to .env.local for the database: these scripts TRUNCATE
 * tables, and falling back would point them at the application's own project.
 * That is the exact accident `tests/env.ts` was written to prevent.
 *
 * Anchored on __dirname rather than process.cwd(), so a script behaves the
 * same whether it is run from backend/ or from the repository root.
 *
 * A missing .env.local is not an error in normal mode - a fresh clone has only
 * .env.
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const ROOT = path.join(__dirname, "..");
const testMode = process.env.NODE_ENV === "test" || process.argv.includes("--test");

if (testMode) {
  const testFile = path.join(ROOT, ".env.test.local");
  let parsed = {};
  try {
    parsed = dotenv.parse(fs.readFileSync(testFile));
  } catch {
    /* reported below */
  }

  if (!parsed.DATABASE_URL) {
    throw new Error(
      "Test mode needs backend/.env.test.local with a DATABASE_URL pointing at a\n" +
        "second Supabase project. Refusing to fall back to .env.local: these\n" +
        "scripts truncate tables, and that file points at the application database.\n\n" +
        "Create the file, apply the schema once with `npm run db:migrate:test`,\n" +
        "then run `npm run db:seed:test`."
    );
  }

  dotenv.config({
    path: [testFile, path.join(ROOT, ".env.local"), path.join(ROOT, ".env")],
  });
} else {
  dotenv.config({
    path: [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")],
  });
}

module.exports = process.env;
