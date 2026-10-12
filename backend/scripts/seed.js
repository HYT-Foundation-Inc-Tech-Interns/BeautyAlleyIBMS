#!/usr/bin/env node
/**
 * Deterministic seed data.
 *
 * Wipes the transactional tables and inserts a small, fixed dataset: four
 * services, three stylists with qualifications and weekly hours, two promo
 * codes and two registered clients.
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

const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

/** Fixed uuids so tests can reference them without a lookup. */
const IDS = {
  svcMassage: "11111111-0000-0000-0000-000000000001",
  svcFacial: "11111111-0000-0000-0000-000000000002",
  svcHaircut: "11111111-0000-0000-0000-000000000003",
  svcManiPedi: "11111111-0000-0000-0000-000000000004",

  empAna: "22222222-0000-0000-0000-000000000001",
  empBea: "22222222-0000-0000-0000-000000000002",
  empCara: "22222222-0000-0000-0000-000000000003",

  clientAda: "33333333-0000-0000-0000-000000000001",
  clientBen: "33333333-0000-0000-0000-000000000002",

  promoPercent: "44444444-0000-0000-0000-000000000001",
  promoFixed: "44444444-0000-0000-0000-000000000002",
};

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

async function seed(client, { quiet = false } = {}) {
  const log = (msg) => {
    if (!quiet) process.stdout.write(msg + "\n");
  };

  await clear(client);
  log(`${c.cyan}cleared existing data${c.reset}`);

  // --- services ------------------------------------------------------------
  await client.query(
    `insert into public.services (id, name, category, description, price_cents, duration_minutes, is_active)
     values
       ($1, 'Signature Massage',  'SPA',      'Deep tissue, 60 minutes',        250000, 60, true),
       ($2, 'Radiance Facial',    'SALON',    'Brightening treatment',          180000, 45, true),
       ($3, 'Cut & Style',        'SALON',    'Consultation, cut and finish',   120000, 45, true),
       ($4, 'Manicure & Pedicure','WELLNESS', 'Classic hands and feet',          95000, 60, true)`,
    [IDS.svcMassage, IDS.svcFacial, IDS.svcHaircut, IDS.svcManiPedi]
  );
  log(`${c.green}4 services${c.reset}`);

  // --- employees -----------------------------------------------------------
  await client.query(
    `insert into public.employees (id, full_name, title, bio, is_active)
     values
       ($1, 'Ana Reyes',   'Senior Therapist', 'Fifteen years in therapeutic massage.', true),
       ($2, 'Bea Santos',  'Beauty Specialist','Facials, skin and nail care.',          true),
       ($3, 'Cara Lim',    'Hair Stylist',     'Precision cutting and colour.',         true)`,
    [IDS.empAna, IDS.empBea, IDS.empCara]
  );
  log(`${c.green}3 employees${c.reset}`);

  // --- qualifications ------------------------------------------------------
  // Ana does everything except hair; Bea does facial + nails; Cara does cut.
  // The gaps are deliberate: they let the tests prove EMPLOYEE_NOT_QUALIFIED
  // is enforced rather than incidentally true.
  const quals = [
    [IDS.empAna, IDS.svcMassage],
    [IDS.empAna, IDS.svcFacial],
    [IDS.empAna, IDS.svcManiPedi],
    [IDS.empBea, IDS.svcFacial],
    [IDS.empBea, IDS.svcManiPedi],
    [IDS.empCara, IDS.svcHaircut],
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

  log(`\n${c.bold}${c.green}seed complete${c.reset}`);
  return IDS;
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

module.exports = { seed, IDS, clear };
