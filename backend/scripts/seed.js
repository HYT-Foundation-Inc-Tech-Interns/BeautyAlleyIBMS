#!/usr/bin/env node
/**
 * Deterministic seed data.
 *
 * Wipes the transactional tables and inserts a fixed dataset: the full
 * five-service catalogue, three stylists with qualifications and weekly
 * hours, two promo codes and two registered clients.
 *
 * ## Why the whole catalogue lives here, not just the four salon services
 *
 * This script TRUNCATES `public.services` and rebuilds it. For a long time it
 * rebuilt only the four original salon services, which meant that every
 * `npm test` silently deleted the ten wellness services (IV drips, beauty
 * shots, add-ons) that migrations 22 and 23 had put there. The tests passed and
 * the catalogue quietly shrank, and the loss only surfaced when the public
 * menu was opened by hand.
 *
 * A seed that rebuilds a table has to rebuild *all* of it. So the catalogue is
 * defined once, below, with fixed uuids, and migration 28 inserts the same ten
 * wellness rows into databases this script never touches (production, and any
 * environment where the tests do not run).
 *
 * Idempotent by construction - it truncates first - so running it twice gives
 * the same database. That matters because the test suite asserts against these
 * exact rows, and "it passed on my machine" is usually just leftover state.
 *
 *   node scripts/seed.js          # seed
 *   node scripts/seed.js --quiet  # seed, no output (used by the tests)
 */

require("./_load-env");
const path = require("path");
const { Client } = require("pg");

/**
 * Where DATABASE_URL actually points, for error messages. Never includes the
 * password - `URL.host` is host and port only.
 */
function databaseHost(env = process.env) {
  try {
    return new URL(env.DATABASE_URL).host || "(no host)";
  } catch {
    return "(DATABASE_URL missing or unparseable)";
  }
}

/**
 * Destructive-operation guard.
 *
 * `seed()` TRUNCATEs seventeen tables. That is correct for a disposable
 * database and catastrophic for a real one, so the caller has to declare which
 * it is. Three ways to declare it, in decreasing order of convenience:
 *
 *   ALLOW_DESTRUCTIVE_SEED=1   backend/.env.local - a per-machine statement
 *                              that this database is safe to wipe
 *   --force                    one-off, visible in the command line
 *   { confirmed: true }        programmatic callers (Jest globalSetup)
 *
 * `NODE_ENV=production` is refused outright: no flag makes truncating
 * production correct, and the person who runs `npm test` with a production
 * DATABASE_URL is exactly who this protects.
 */
function assertDestructiveAllowed({
  confirmed = false,
  argv = process.argv,
  env = process.env,
} = {}) {
  const host = databaseHost(env);

  if (env.NODE_ENV === "production") {
    throw new Error(
      `seed.js TRUNCATEs 17 tables and refuses to run with NODE_ENV=production.\n` +
        `Target: ${host}\n` +
        `Restore a backup, or point DATABASE_URL at a disposable database.`
    );
  }

  if (confirmed || argv.includes("--force")) return;

  if (env.ALLOW_DESTRUCTIVE_SEED === "1") return;

  throw new Error(
    `seed.js TRUNCATEs 17 tables in the database at ${host}.\n\n` +
      `If that database is disposable, either:\n` +
      `  - set ALLOW_DESTRUCTIVE_SEED=1 in backend/.env.local, or\n` +
      `  - re-run with --force (e.g. npm run db:seed -- --force).\n\n` +
      `If it is not disposable, stop here - this script has no undo.`
  );
}

const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

/** Fixed uuids so tests can reference them without a lookup. */
const IDS = {
  // The five treatments on the business's printed price list. These are the
  // same uuids migration 41 uses, so a seeded database and a migrated one
  // agree row for row.
  svcCombination: "11111111-0000-0000-0000-000000000021",
  svcHotStone: "11111111-0000-0000-0000-000000000022",
  svcTherapeutic: "11111111-0000-0000-0000-000000000023",
  svcBodyScrub: "11111111-0000-0000-0000-000000000024",
  svcBodyScrubMassage: "11111111-0000-0000-0000-000000000025",

  empAna: "22222222-0000-0000-0000-000000000001",
  empBea: "22222222-0000-0000-0000-000000000002",
  empCara: "22222222-0000-0000-0000-000000000003",

  clientAda: "33333333-0000-0000-0000-000000000001",
  clientBen: "33333333-0000-0000-0000-000000000002",

  promoPercent: "44444444-0000-0000-0000-000000000001",
  promoFixed: "44444444-0000-0000-0000-000000000002",
};

/**
 * The second catalogue level. Migration 41 owns this row in production; it is
 * re-stated here (idempotently, matched on the unique slug) so a database that
 * this script has just cleared is still self-sufficient.
 */
const SUBCATEGORIES = [
  { category: "SPA", name: "Massage & Body", slug: "massage-body", sortOrder: 10 },
];

/**
 * The whole menu. Names, descriptions and prices are the business's own and are
 * never invented here. See the note inside the array for the two values the
 * printed price list does not supply.
 */
const SERVICES = [
  // --- massage and body ----------------------------------------------------
  // The five treatments on the business's printed price list. The names,
  // descriptions and prices are the business's own. Two values it does not
  // supply are chosen here and flagged, never presented as fact:
  //
  //   * DURATIONS are PLACEHOLDERS - the price list carries no times and the
  //     column is NOT NULL. Unlike the retired wellness rows these are not
  //     written into the description, because that copy goes onto the site
  //     verbatim. Correct them in Admin -> Services.
  //
  //   * `requiredRoomType` is null. The demo floor has no MASSAGE rooms, and
  //     requiring a room type that does not exist makes every slot unbookable.
  //
  // These five are the WHOLE catalogue. The four demo salon rows and the ten
  // wellness rows are retired by migration 42 - a seed that rebuilds a table
  // has to rebuild all of it, so they cannot linger here.
  {
    id: IDS.svcCombination,
    name: "Combination Massage",
    category: "SPA",
    subcategory: "massage-body",
    description:
      "These services are designed to promote overall wellness and reduce stress, tension and muscle pain.",
    priceCents: 80000,
    durationMinutes: 60,
    requiredRoomType: null,
  },
  {
    id: IDS.svcHotStone,
    name: "Hot Stone w/ Combination Massage",
    category: "SPA",
    subcategory: "massage-body",
    description:
      "Massage that uses smooth, heated stones to deeply penetrate the muscles and release tension.",
    priceCents: 150000,
    durationMinutes: 90,
    requiredRoomType: null,
  },
  {
    id: IDS.svcTherapeutic,
    name: "Therapeutic Massage",
    category: "SPA",
    subcategory: "massage-body",
    description:
      "Gentle massage that uses essential oils to promote relaxation and balance in the body and mind.",
    priceCents: 95000,
    durationMinutes: 60,
    requiredRoomType: null,
  },
  {
    id: IDS.svcBodyScrub,
    name: "Body Scrub",
    category: "SPA",
    subcategory: "massage-body",
    description:
      "A rejuvenating treatment that gently exfoliates the skin to remove dead skin cells, leaving the body feeling smooth, soft, and refreshed.",
    priceCents: 50000,
    durationMinutes: 60,
    requiredRoomType: null,
  },
  {
    id: IDS.svcBodyScrubMassage,
    name: "Body Scrub w/ Massage",
    category: "SPA",
    subcategory: "massage-body",
    description:
      "A refreshing treatment that combines gentle body exfoliation and relaxing massage to leave the skin smooth, the body relaxed, and the senses revitalized.",
    priceCents: 120000,
    durationMinutes: 90,
    requiredRoomType: null,
  },
];
/**
 * Truncation order matters: `cascade` handles the foreign keys, but listing
 * the tables explicitly documents what is considered "data" rather than
 * reference configuration.
 */
async function clear(client) {
  await client.query(`
    truncate table
      public.checkins,
      public.qr_tokens,
      public.promo_redemptions,
      public.booking_items,
      public.bookings,
      public.booking_counters,
      public.attendance,
      public.tasks,
      public.time_off,
      public.working_hours,
      public.employee_services,
      public.promo_codes,
      public.audit_logs,
      public.login_attempts,
      public.clients,
      public.employees,
      public.services
    restart identity cascade
  `);
}

async function seed(client, { quiet = false, confirmed = false } = {}) {
  // Before anything else: is this database allowed to be wiped? See
  // assertDestructiveAllowed above for the three ways to say yes.
  assertDestructiveAllowed({ confirmed });

  const log = (msg) => {
    if (!quiet) process.stdout.write(msg + "\n");
  };

  log(`${c.yellow}seeding ${databaseHost()}${c.reset}`);

  await clear(client);
  log(`${c.cyan}cleared existing data${c.reset}`);

  // --- second-level catalogue ---------------------------------------------
  // Matched on the unique slug, so re-running against a database where
  // migration 22 already inserted them changes nothing.
  for (const sub of SUBCATEGORIES) {
    await client.query(
      `insert into public.service_subcategories (category, name, slug, sort_order)
       values ($1, $2, $3, $4)
       on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order`,
      [sub.category, sub.name, sub.slug, sub.sortOrder]
    );
  }
  const subRows = await client.query("select id, slug from public.service_subcategories");
  const subIdBySlug = Object.fromEntries(subRows.rows.map((r) => [r.slug, r.id]));
  log(`${c.green}${SUBCATEGORIES.length} subcategories${c.reset}`);

  // --- services ------------------------------------------------------------
  // One statement per row rather than a single multi-row VALUES: the column
  // list is long and the optional fields (subcategory, ingredients, room type)
  // differ per row, so a positional VALUES list would be a wall of `$n` that
  // silently shifts the moment a column is added.
  for (const svc of SERVICES) {
    await client.query(
      `insert into public.services
         (id, name, category, description, price_cents, duration_minutes, is_active,
          subcategory_id, required_room_type, ingredients, ingredients_verified,
          loyalty_eligible, needs_pricing)
       values ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10, false, false)`,
      [
        svc.id,
        svc.name,
        svc.category,
        svc.description,
        svc.priceCents,
        svc.durationMinutes,
        svc.subcategory ? (subIdBySlug[svc.subcategory] ?? null) : null,
        svc.requiredRoomType,
        svc.ingredients ?? null,
        svc.ingredientsVerified ?? true,
      ]
    );
  }
  log(`${c.green}${SERVICES.length} services${c.reset}`);

  // --- employees -----------------------------------------------------------
  await client.query(
    `insert into public.employees (id, full_name, title, bio, is_active)
     values
       ($1, 'Ana Reyes',   'Senior Therapist', 'Fifteen years in therapeutic massage.', true),
       ($2, 'Bea Santos',  'Beauty Specialist','Body scrubs and skin care.',            true),
       ($3, 'Cara Lim',    'Massage Therapist','Therapeutic and hot-stone work.',       true)`,
    [IDS.empAna, IDS.empBea, IDS.empCara]
  );
  log(`${c.green}3 employees${c.reset}`);

  // --- qualifications ------------------------------------------------------
  // Ana is the senior therapist and takes the massages plus the scrubs. Bea is
  // the skin specialist and takes the two body scrubs. Cara is the therapeutic
  // specialist and takes Therapeutic Massage and Hot Stone.
  //
  // The gaps are deliberate, and the integration tests depend on them: one
  // service must be deliverable by exactly one person (Therapeutic -> Cara) so
  // auto-assignment is forced, one by two people (Body Scrub -> Ana or Bea) so
  // the desk can move a booking between them, and one Cara cannot take at all
  // (Combination -> Ana) so EMPLOYEE_NOT_QUALIFIED is proven rather than
  // incidentally true.
  const quals = [
    [IDS.empAna, IDS.svcCombination],
    [IDS.empAna, IDS.svcBodyScrub],
    [IDS.empAna, IDS.svcBodyScrubMassage],
    [IDS.empBea, IDS.svcBodyScrub],
    [IDS.empBea, IDS.svcBodyScrubMassage],
    [IDS.empCara, IDS.svcTherapeutic],
    [IDS.empCara, IDS.svcHotStone],
  ];

  const qualParams = [];
  const qualValues = quals.map(([emp, svc]) => {
    qualParams.push(emp, svc);
    const n = qualParams.length;
    return `($${n - 1}, $${n})`;
  });
  await client.query(
    `insert into public.employee_services (employee_id, service_id) values ${qualValues.join(",")}`,
    qualParams
  );
  log(`${c.green}${quals.length} qualifications${c.reset}`);

  // --- working hours -------------------------------------------------------
  // Monday(1) to Saturday(6), 09:00-18:00 branch local time. Sunday closed.
  // An empty working_hours row set is a meaningful state too - it means the
  // employee is bookable nowhere - so the tests cover both.
  const days = [1, 2, 3, 4, 5, 6];
  const hoursValues = [];
  const hoursParams = [];
  for (const emp of [IDS.empAna, IDS.empBea, IDS.empCara]) {
    for (const d of days) {
      hoursParams.push(emp, d);
      hoursValues.push(`($${hoursParams.length - 1}, $${hoursParams.length}, '09:00', '18:00')`);
    }
  }
  await client.query(
    `insert into public.working_hours (employee_id, weekday, start_time, end_time) values ${hoursValues.join(",")}`,
    hoursParams
  );
  log(`${c.green}18 working-hour rows${c.reset}`);

  // --- promo codes ---------------------------------------------------------
  await client.query(
    `insert into public.promo_codes
       (id, code, type, value, starts_at, ends_at, max_redemptions, per_client_limit, min_spend_cents, is_active)
     values
       ($1, 'SAVE10', 'PERCENT', 10, now() - interval '1 day', now() + interval '365 days', 100, 1, 0,     true),
       ($2, 'FLAT500','FIXED',  50000, now() - interval '1 day', now() + interval '365 days', 2, 1, 100000, true)`,
    [IDS.promoPercent, IDS.promoFixed]
  );
  log(`${c.green}2 promo codes${c.reset}`);

  // --- clients -------------------------------------------------------------
  await client.query(
    `insert into public.clients (id, full_name, phone, email, is_active)
     values
       ($1, 'Ada Cruz',  '+639171111111', 'ada@example.com',  true),
       ($2, 'Ben Ocampo','+639172222222', 'ben@example.com',  true)`,
    [IDS.clientAda, IDS.clientBen]
  );
  log(`${c.green}2 clients${c.reset}`);

  // --- put the demo logins back -------------------------------------------
  await relinkDemoProfiles(client, log);

  log(`\n${c.bold}${c.green}seed complete${c.reset}`);
  return IDS;
}

/**
 * Re-attach the demo auth accounts to the rows this seed just rebuilt.
 *
 * ## Why this exists
 *
 * The truncate above takes out `public.employees` and `public.clients`, and
 * with them the `profile_id` pointers that make a demo login *be* a stylist or
 * a customer. The auth users in `auth.users` survive (the seed never touches
 * them), so the symptom is nasty and quiet: every demo account still signs in
 * perfectly, and every one of them comes back with `employeeId: null`.
 *
 * The visible failures were a stylist seeing "This account is not linked to an
 * employee record" on their own attendance page, and `/tasks/mine`,
 * `/tasks/counts` and `/attendance/summary` answering 403 — because the
 * service layer refuses to guess whose records an unlinked employee means.
 * Running `npm test` was enough to cause it, since the Jest global setup runs
 * this seed.
 *
 * So the seed now repairs what it broke. It reads `accounts.json`, the list of
 * the four role logins, so the ids cannot drift from the accounts that exist,
 * and it is entirely best-effort: if the auth users have never been created, it
 * quietly does nothing.
 *
 * @param {import("pg").Client} client
 * @param {(msg: string) => void} [log]
 */
async function relinkDemoProfiles(client, log = () => {}) {
  let demo;
  try {
    const file = path.resolve(__dirname, "..", "..", "accounts.json");
    demo = JSON.parse(require("fs").readFileSync(file, "utf8"));
  } catch {
    return; // no demo file — nothing to relink, and not an error
  }

  let linked = 0;

  for (const account of demo.accounts ?? []) {
    if (!account.employeeId && !account.clientId) continue;

    // The profile id is the auth user's id; `profiles` cascades from `auth.users`.
    const { rows } = await client.query(
      `select p.id from public.profiles p
         join auth.users u on u.id = p.id
        where lower(u.email) = lower($1)`,
      [account.email]
    );
    const profileId = rows[0]?.id;
    if (!profileId) continue; // account not created yet

    if (account.employeeId) {
      await client.query(`update public.employees set profile_id = $1 where id = $2`, [
        profileId,
        account.employeeId,
      ]);
      linked += 1;
    }

    if (account.clientId) {
      /*
       * Detach first. `clients.profile_id` is UNIQUE, and a demo client who has
       * ever signed in through the app has a second clients row auto-created
       * for them — so setting the pointer on the canonical row while the stale
       * one still holds it raises 23505 and aborts the whole seed.
       */
      await client.query(
        `update public.clients set profile_id = null where profile_id = $1 and id <> $2`,
        [profileId, account.clientId]
      );
      await client.query(
        `update public.clients set profile_id = $1, email = $2 where id = $3`,
        [profileId, account.email, account.clientId]
      );
      linked += 1;
    }
  }

  if (linked > 0) {
    log(`${c.green}${linked} demo account link(s) restored${c.reset}`);
  }
}

async function main() {
  const quiet = process.argv.includes("--quiet");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await seed(client, { quiet });
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`\nseed failed: ${e.message}\n`);
    process.exit(1);
  });
}

module.exports = { seed, IDS, clear, relinkDemoProfiles, assertDestructiveAllowed, databaseHost };
