# Baseline — 4 November 2026

Recorded before Phase 0 changes, so every later phase has something to compare against.

**Repository:** `TheBeautyAlley`, branch `main`, commit `aa8bcf8`.
**Working tree:** contains pre-existing documentation changes from 30 October (README, apiIndex, runbook) plus this phase's edits. No commit was made before recording.

## Checks

| Check | Command | Result |
|---|---|---|
| Frontend types | `npm run typecheck` (repo root) | **Pass**, no output |
| Backend types | `npm run typecheck` (backend) | **Pass**, no output |
| Unit tests | `npm run test:unit` (backend) | **Pass** — 9 suites, 170 tests, 10.5 s |
| Integration tests | `npm test` (backend) | **Blocked by design** — see below |
| Schema and RLS | `npm run db:verify` | **Pass** — 51 checks, 0 failed |
| Migration ledger | `npm run db:status` | **44 applied, 0 pending**, 1 sequence warning |
| Booking correctness | `npm run verify:booking` | **Blocked** — `ACCOUNT_PASSWORD` not set |
| Atomicity | `npm run verify:atomicity` | **Blocked** — `ACCOUNT_PASSWORD` not set |

## Why the integration suite cannot run here

`tests/globalSetup.ts` refuses to seed the database that `backend/.env.local`
points at, because the suite truncates seventeen tables. That guard is correct
and should not be bypassed. Running the integration suite requires a second
Supabase project configured in `backend/.env.test.local`:

```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=postgresql://...
```

Until that file exists, the project's real test coverage is the 170 unit tests
plus the 51 schema checks plus the two verification scripts — not the 389 figure
quoted in earlier notes, which assumes the integration suite can run.

The verification scripts also need `ACCOUNT_PASSWORD` in the environment. The
password is deliberately not in the repository, so a fresh machine cannot run
them without someone supplying it.

## Size and shape

| Measure | Value |
|---|---|
| Console pages | 19 files, 11,513 lines |
| Pages over 500 lines | 8 — Overview 1,372; Board 902; Team 887; NewBooking 872; Book 766; Services 703; Bookings 698; Tasks 639 |
| Backend modules | 13 — admin, attendance, auth, bookings, clients, employees, loyalty, promos, qr, rooms, services, subcategories, tasks |
| Migrations | 44 files, all applied |
| Domain tables | 18 `create table` statements |
| Migration anomaly | `20261026000042_five_service_menu` is followed by `20261027000041_early_checkin_override`; versions are unique and order is correct, only the two-digit label repeats |

## Open defects carried into Phase 1

1. The live host runs with `NODE_ENV` unset; CORS reflects any origin with credentials.
2. The service-role key and demo password were committed at some point and have not been rotated.
3. The generic rate limiter is per-instance on serverless; the effective ceiling was undocumented (now `RATE_LIMIT_MAX`, default 120).
4. The arrival pass says "valid until" a timestamp a day after the service, while check-in refuses after the service ends (fixed in this phase).
5. `SCOPE` had dead ends: ADMIN could not open the task board its API allowed, and EMPLOYEE could not scan arrivals although the API allowed it (both fixed). The desk's blurb promised "client records" it cannot open — the page is ADMIN-only, so the copy was corrected rather than the permission widened.

## Phase 1 result, same day

| Check | Result |
|---|---|
| CORS probe against an API with an empty allow-list | **FAIL as intended** — reflected `https://evil.example.com` with credentials, exit 1 |
| CORS probe against `NODE_ENV=production` with `ALLOWED_ORIGINS=http://localhost:5173` | **PASS** — `/health` reports `production`, hostile origin not reflected |
| Allow-listed origin in production | **PASS** — `Access-Control-Allow-Origin: http://localhost:5173` |
| Unit tests after the pass-window change | **174 passed** (4 new) |
| `npm run check:roles` | **Pass** — 4 roles, 13 areas |
| Frontend and backend typecheck | **Pass** |
| Production deployment | **Done** — `NODE_ENV=production` and `ALLOWED_ORIGINS` set for Production only, then deployed |
| Live `/health` | `"env":"production"` |
| Live CORS probe | **PASS** — hostile origin not reflected; the allow-listed origin still receives `Access-Control-Allow-Origin` |
| Frontend build | **Pass** — 12.8 s |

A deployment bug surfaced while doing this: once `NODE_ENV=production` is set in
the Vercel project, `npm ci` omits devDependencies, so the backend build loses
`typescript` and `@types/express` and fails with TS7016. The build command in
`vercel.json` now uses `npm ci --include=dev`, and the README documents why.

## Settings release, same day

| Change | Detail |
|---|---|
| Schema | Migration 44 `app_settings` (key/value JSONB, RLS on, no public policies), seeded with five payment providers, all enabled |
| Schema fix | Migration 45 grants `service_role` access; without it PostgREST answered 42501, which the error mapper turned into a generic 403 |
| API | `GET/PUT /api/v1/settings/payments` (ADMIN), `POST /api/v1/auth/password` (self, current password required), `POST /api/v1/admin/users/password` (ADMIN, by email) |
| Console | `/app/settings`: My account, Account recovery (ADMIN), Payments (ADMIN) |
| Rename | `/app/board` → `/app/insights`; old route redirects; area renamed in `SCOPE` |
| Tests | 187 unit tests (13 new for settings and password schemas), 51 schema checks |
| Live smoke | 11/11 checks passed against production with temporary accounts, deleted afterwards |
| Production | Deployed; `/health` reports `production`; `/app/settings`, `/app/insights`, `/app/board` all return 200 |

The 42501 detour is worth remembering: **RLS bypass is not a table grant.**
A new table with RLS enabled and no policies will still refuse the service role
if the creating role's default privileges did not include it. The symptom is a
403 that looks like a role bug; the fix is one `grant`.

## Test database, same night

Created `beautyalley-test` (`csfxgyvclrtklkqbguda`, Singapore) as a second free
Supabase project. The payroll project was paused for the duration and restored
afterwards; the test project is now paused so both fit inside the free plan's
two active slots.

| Check | Result |
|---|---|
| Migrations on an empty project | **48 applied**, 0 pending |
| Seed | 1 subcategory, 5 services, 3 employees, 18 working-hour rows, 2 promos, 2 clients |
| Integration suite | **460 passed, 0 failed** — 23 suites, 314 s |
| Unit suite | 187 passed |
| Production after the new migrations | `/health` healthy; public catalogue 200; settings smoke 11/11; CORS smoke PASS |

The first run on a clean project found two gaps that production had hidden
because the data and grants were applied by hand years earlier:

1. **Migration 23 could not find the four legacy demo services.** No migration
   ever created them, so a fresh install failed at 23. Migration `22a` inserts
   them only when `needs_pricing` does not exist yet (i.e. on a fresh database),
   and 23 then deactivates them as designed.
2. **The fresh project had Supabase's default broad grants** to `anon` and
   `authenticated`, while production had been hardened to SELECT-only plus two
   column-scoped UPDATE grants. Three tests failed on the gap. Migration `46`
   reproduces production's privilege matrix; it is idempotent on production.

`npm run db:verify` on production stopped at the QR section with
`OUTSIDE_WORKING_HOURS` at 23:00. That is a time-of-day dependency in the verify
script, not a privilege failure; it passed earlier the same evening and the
full suite covers the same path on the test project.

Still outstanding, and they need dashboard access rather than code:

- **Service-role key.** Create a new secret key in Supabase, put it in
  `backend/.env.local`, then tell me — I update Vercel from that file and
  redeploy without printing it. Revoke the old key afterwards and record the
  date in the runbook.
- **Demo password.** `accounts.json` no longer stores it (the field was unused
  and removed). Choose a new one of at least 12 characters, put it in
  `backend/.env.local` as `ACCOUNT_PASSWORD`, and run
  `npm run rotate:demo-password`. The script updates all four Auth users and
  never prints the value.
- **Access token.** The personal access token used to create and swap the test
  project is still valid and was pasted in chat. Revoke it at
  `https://supabase.com/dashboard/account/tokens` once you no longer need it.

## Phase 2, first slice

| Change | Detail |
|---|---|
| Arrivals | `QR Check-in` and `Scan arrival pass` merged into `/app/arrivals` with two modes: **Scan & confirm** (default) and **Quick check-in**. Old routes redirect into the matching mode. One nav item, one area (`arrivals`) for ADMIN, CONCIERGE and EMPLOYEE. |
| Today | Overview no longer branches to a 1,000-line admin dashboard. Every staff role gets the run sheet; the owner gets an **Insights** shortcut in the header. New Requests now shows for the owner as well as the desk. Overview went from **1,372 to 578 lines**. |
| Removed | `AdminOverview`, its KPI/chart helpers and `RecentBookings` — the same job is done by Insights, which is now the only analytics surface. |
| Visual QA | Four pages captured in a real browser as a temporary ADMIN (Today, both arrival modes, Insights): one header each, tabs and panels aligned, no console or page errors. |

## Phase 2, second slice

| Change | Detail |
|---|---|
| One task card | New `src/components/app/task-card.tsx` owns the header, badges, metadata grid, instructions and notes. The desk passes Edit/Cancel and its edit form; the floor passes Start/Mark complete. `Tasks.tsx` 639 → 580 lines, `MyTasks.tsx` 388 → 297 lines. |
| Coupling removed | `Tasks.tsx` no longer imports its badges from `@/pages/MyTasks`; the vocabulary lives in the component. The two pages had already drifted on completion-note labels and instruction styling. |
| Cross-links | Booking → client (`/app/clients?client=<id>` opens the record), client → bookings (`/app/bookings?range=all&q=<name>`), booking → pass already existed at `/pass/<id>`. |
| Role labels | Display names are now **Owner / Front desk / Therapist / Client**. Internal codes (`ADMIN`, `CONCIERGE`, `EMPLOYEE`, `CLIENT`), `SCOPE` and every API guard are unchanged. Login page, Settings, team role select and demo blurbs updated. |
| Visual QA | One task card on the board and one on My Tasks, plus a real click-through booking → client → bookings. No console or page errors; temporary users/tasks removed afterwards. |

Phase 2 is complete. Next is Phase 3: the server-state layer, consolidating the
three check-in surfaces, decomposing the remaining pages over 500 lines, and the
accessibility pass.

## Built-in test gateway (free, no merchant account)

| Change | Detail |
|---|---|
| Store | Migration 49 adds `test_payment_requests` (reference, amount, PENDING/PAID/CANCELLED). Service-role only, RLS on. |
| Hosted page | `/deposit/mock` now reads a real payment row, shows PENDING/PAID/CANCELLED, and offers **Pay now (test)** / Cancel. |
| Signed webhook | `POST /api/v1/webhooks/hitpay` verifies `Hitpay-Signature` (HMAC-SHA256 over the raw body with `HITPAY_SALT`) before marking PAID. The simulator pays through this exact handler. |
| Verified | 201 checkout → PENDING → bad signature 401 → valid signature 200 → PAID; browser flow paid a second request, no browser errors. Test rows and temp users cleaned up. |
| Still not | Attached to a booking. That is the next slice. |

## HitPay test checkout

| Change | Detail |
|---|---|
| UI | Settings → **Deposits (test)**: an amount and a button that opens a HitPay checkout. Clearly labelled as not attached to a booking. |
| API | `POST /api/v1/deposits/test-checkout` (ADMIN) with `amountCents` 100–1,000,000. With a HitPay key it creates a real payment request (sandbox or live); without one it returns an internal mock URL. |
| Mock | `/deposit/mock` says TEST MODE, shows the amount and reference, and simulates success/cancel without writing anything. |
| Verified | Mock mode: 201, mock URL, page rendered, simulated payment, no browser errors. A live key was supplied and authenticates (`GET /v1/payment-requests` → 200), but creating a payment request returns 403 because the HitPay store is not yet verified. Rolled back to mock; no live payment request was created. |
| Not yet | This is a test surface. A deposit is not a condition of a booking, and no booking row is marked paid. That wiring is the next step once the account is confirmed. |

## Reminder outbox

| Change | Detail |
|---|---|
| Queue | Migration 48 adds `reminder_outbox` (booking, kind, send_at, status, attempts, error). A trigger queues **24h** and **2h** on insert/reschedule and marks pending rows `SKIPPED` on cancel/complete/no-show. |
| Sender | `scripts/reminders.js`, run as `npm run reminders` or `npm run reminders:dry`. It sends only `PENDING` rows whose `send_at` has passed, marks `SENT`/`FAILED`, and leaves everything `PENDING` when SMTP is absent. |
| SMTP | Gmail SMTP is configured (host, port, user, from, app password). Credentials live only in gitignored `backend/.env.local` and the Vercel production environment. `npm run mail:test` sends one test. |
| Verified | A temporary booking three days out queued both rows (`24h`, `2h`); after making the 2h row due, `npm run reminders` sent a real email to the owner's Gmail and marked the row `SENT` with `sent_at`. Booking, client and user were deleted afterwards. Zero leftover rows. |
| Scheduler | An hourly WorkBuddy automation runs `npm run reminders` in the workspace. Tighter timing is possible with a 5–15 minute cron pointing at the same command. |
| Console | Settings → Reminders shows SMTP status, queued/sent/failed/skipped, next due time, and a test-email button. `GET /settings/reminders`, `POST /settings/reminders/test`, ADMIN only. |

## Client self-service

| Change | Detail |
|---|---|
| Move / cancel | My bookings now has **Move** and **Cancel** on any PENDING or CONFIRMED appointment in the future. Move opens the stylist's open slots for a date; Cancel takes an optional reason. |
| Policy, not prose | The sentence under the list reads `GET /api/v1/settings/public` (no auth, two numbers only), so it cannot disagree with the server's cutoff. A client's reschedule is refused inside the same cutoff; staff remain exempt. |
| No stale row | The reschedule response replaces the row in place, so the card and the success notice show the same time immediately rather than waiting for the list refetch. |
| E2E | A temporary client and booking were created on production: 15 slots in the dialog, moved to 10:30, card updated, cancelled with a reason, **no browser errors**. Booking, client and auth user were then deleted; verified zero leftovers. |

## Settings, second pass

| Change | Detail |
|---|---|
| Booking rules | Migration 47 seeds `booking.rules` with the current policy (2 hours, 60 minutes). `GET/PUT /api/v1/settings/booking`, ADMIN only. |
| Enforced, not decorative | The values are read by `cancel_booking` (`p_window_hours`), `check_in_booking` (`p_window_minutes`), pass rendering (`passFor`) and `/qr/branch`. The env values are fallbacks only. |
| UI | Settings → Booking rules, with both numbers, server-side validation (0–72 hours, 0–240 minutes) and a "current policy" line. |
| Tests | 194 unit tests (7 new for the schema), 16/16 live smoke checks including PUT → GET → restore. |
| Visual | Captured in a browser as a temporary ADMIN; fields, hints and Save render correctly, then the account was removed. |

A behavioural probe against a real booking was not possible: the production
database currently has **zero bookings**, so there is no pass to shift. The
storage round-trip is covered by the smoke, and the read path is typechecked and
exercised by the integration suite on the test project.

## Housekeeping noticed, not changed

- `backend/.tmp-svc.cjs` is an untracked scratch script from 27 October. It contains no secret, but it should not be committed.
- `output/` contains generated documents and is untracked.
