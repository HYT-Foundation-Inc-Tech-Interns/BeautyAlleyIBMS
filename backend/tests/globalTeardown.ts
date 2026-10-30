/**
 * Jest globalTeardown - runs once, after every suite has finished.
 *
 * ## Why this is not optional
 *
 * `globalSetup` seeds the database, which rebuilds `public.employees` from
 * scratch and then calls `relinkDemoProfiles()` to put the demo logins back.
 * That is necessary but not sufficient, because the suites run *after* it and
 * some of them legitimately borrow a seeded employee row:
 *
 *   - `tests/integration/qr.test.ts` calls `createTestStaff(EMP_ANA)` - the
 *     demo stylist - because a check-in test needs a real stylist with a real
 *     rota behind them.
 *   - `createTestStaff` does `update public.employees set profile_id = $1
 *     where id = $2`, which is correct for a test fixture and which
 *     *overwrites* the demo account's pointer.
 *   - The suite's `afterAll` then calls `deleteTestUsers()`, deleting that
 *     throwaway auth user. `employees.profile_id` references `profiles(id)`,
 *     which cascades from `auth.users`, so the delete nulls the pointer.
 *
 * Net effect, before this file existed: `npm test` passed, and left the
 * Employee demo login silently broken - the account still authenticated
 * perfectly but came back with `employeeId: null`, so `/attendance/me`,
 * `/tasks/mine` and `/attendance/summary` answered 403. The failure showed up
 * later, in the browser, and looked like an app bug.
 *
 * ## Why it reads the *test* target, not `.env.local`
 *
 * It used to load `backend/.env.local` explicitly and write to whatever
 * `DATABASE_URL` said there - the application's own Supabase project. So even
 * a unit-only run, which never opens a database, ended by writing to the pilot
 * database: my own `npm run test:unit` reported "2 demo account link(s)
 * restored" against it. `relinkDemoProfiles` reassigns `employees.profile_id`
 * and `clients.profile_id`/`email`, so those writes are not harmless.
 *
 * It now uses the same target resolution as `globalSetup` - `.env.test.local`
 * first, and `assertSeparateDatabase()` before touching anything - and it does
 * nothing at all when the run never seeded.
 */
import { assertSeparateDatabase, isUnitOnlyRun, loadTestEnv } from "./env";
import { releaseRunLock } from "./helpers/runLock";

export default async function globalTeardown() {
  // Same precedence as globalSetup: a test project in .env.test.local wins.
  loadTestEnv();

  /*
   * A run that never seeded has nothing to repair, and must not write to any
   * database - least of all the one the application serves.
   */
  if (isUnitOnlyRun() || !process.env.DATABASE_URL) {
    releaseRunLock();
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Client } = require("pg");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { relinkDemoProfiles } = require("../scripts/seed.js");

  try {
    /*
     * globalSetup already refused an unsafe target, so reaching here means the
     * suite seeded a disposable database. Checking again costs one comparison
     * and makes this file safe on its own terms.
     */
    const url = assertSeparateDatabase();

    const client = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();
      // `relinkDemoProfiles` reports through the logger it is handed; capture
      // the line so the run says whether anything actually had to be repaired.
      const messages: string[] = [];
      await relinkDemoProfiles(client, (msg: string) => messages.push(msg));
      // eslint-disable-next-line no-console
      console.log(
        `[globalTeardown] demo account links re-checked${messages.length ? ` - ${messages.join("; ")}` : " - all intact"}`
      );
    } finally {
      await client.end().catch(() => undefined);
    }
  } catch (err) {
    // A teardown that fails a green test run is worse than the problem it fixes.
    // eslint-disable-next-line no-console
    console.warn(
      `[globalTeardown] could not re-link demo accounts: ${(err as Error).message}`
    );
  } finally {
    // Last thing the run does: a lock left behind would block the next one.
    releaseRunLock();
  }
}
