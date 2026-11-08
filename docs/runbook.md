# Operations runbook

For a staff pilot: one salon, one database, a handful of users. This is the
minimum needed to run it without surprises, not a corporate SRE manual.

---

## Environments

| Environment | API | Frontend | Database |
|---|---|---|---|
| Local development | `localhost:4000` | `localhost:5173` (Vite) | Supabase project |
| Pilot | Vercel service, `/api/*` | Vercel service, same project | same Supabase project |

There is no staging environment. For a pilot that is a deliberate trade: a
second Supabase project costs money and drifts. The consequence is that **the
database is the production database**, which is why the backup section below is
not optional.

---

## Deploying

One Vercel project. [`vercel.json`](../vercel.json) keeps the Vite frontend at
the repository root and exposes the Express API as one function,
[`api/index.js`](../api/index.js), which loads the app compiled to
`backend/dist`; `/api/*` and both health endpoints are rewritten to it. The
browser sees one origin, so `VITE_API_URL` is never set and CORS never fires in
the browser.

The API is not built by a framework preset: the project's build command compiles
both halves (`npm run build && cd backend && npm ci && npm run build`). It was
two **services** in this project until every `/api/*` request started answering
a bare `FUNCTION_INVOCATION_FAILED` — the service built, but never produced an
invocable function, whatever the entry exported.

Two variables decide which shape you are running:

| Variable | Vercel | Single container |
|---|---|---|
| `SERVE_APP` | **unset** — the frontend is served by the same project | `true` |
| `ALLOWED_ORIGINS` | **required** — the production boot guard | optional |

The API refuses to boot in production with neither, so on Vercel
`ALLOWED_ORIGINS` is not decoration: set it to `https://<project>.vercel.app`
(plus any preview hostnames you actually use).

The container is the alternative for a self-hosted API:

```bash
docker build -t beauty-alley .
docker run --env-file backend/.env.local -e SERVE_APP=true -p 4000:4000 beauty-alley
```

On Fly.io or Railway, point the platform at this `Dockerfile`, expose port
**4000**, set the health check to **`/health/live`**, and provide the
environment variables below as platform secrets.

### First deploy, in order

1. `cd backend && npm run db:migrate` against the pilot database.
   **Never `db:seed`** here: it truncates 17 tables and is blocked under
   `NODE_ENV=production`.
2. Set the environment variables, then deploy.
3. `GET /health` must return 200, not 503.
4. `/` renders the public site.
5. `/login` signs in, and `/app` renders for that role.
6. Book one appointment end to end and scan its pass, before handing the URL to
   the salon.

### Required environment variables

| Variable | Secret? | Notes |
|---|---|---|
| `SUPABASE_URL` | no | project URL |
| `SUPABASE_ANON_KEY` | no | public by design; shipped to browsers |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | bypasses RLS — treat as a master key |
| `QR_SIGNING_SECRET` | **yes** | rotating it invalidates every outstanding pass |
| `KIOSK_PIN_PEPPER` | **yes** | required for door PINs; rotating it invalidates every PIN |
| `DATABASE_URL` | **yes** | contains the database password |
| `ALLOWED_ORIGINS` | no | required on Vercel; not needed when `SERVE_APP=true` |
| `SERVE_APP` | no | `true` for the container; leave unset on Vercel |
| `NODE_ENV` | no | **`production` on Vercel** — see below; it is what arms the guard |
| `BRANCH_TIMEZONE` | no | `Asia/Manila` |

The API **refuses to boot** in production with an empty `ALLOWED_ORIGINS` and
`SERVE_APP` off. That is intentional: the alternative is reflecting any origin
with credentials.

### `NODE_ENV` is not optional on Vercel

The boot guard above only runs when `NODE_ENV` is exactly `production`, and the
schema defaults it to `development` when it is unset. A Vercel deployment that
never sets it therefore looks healthy while running with **every development
convenience switched on** — most importantly, CORS reflecting any origin with
`Access-Control-Allow-Credentials: true`, which is the hole the guard exists to
prevent.

Two checks, after any deploy. Both are one line and neither needs the dashboard.

```bash
# 1. The environment must say production, not development.
curl -s https://<project>.vercel.app/health | grep -o '"env":"[a-z]*"'

# 2. A foreign origin must NOT be reflected alongside credentials.
curl -s -D - -o /dev/null -H "Origin: https://evil.example.com" \
  https://<project>.vercel.app/api/v1/services \
  | grep -i "access-control-allow-origin"
```

The first must print `"env":"production"`. The second must print nothing. If it
prints the foreign origin, `NODE_ENV` is unset on that project.

The same two checks are packaged as one command that exits non-zero on failure,
so it can be run after every deploy without reading headers by eye:

```bash
cd backend
npm run smoke:cors -- --url https://<project>.vercel.app --expect-production
```

It sends a preflight and a plain GET with `Origin: https://evil.example.com`,
prints the reported environment and the returned CORS headers, and fails if
either request reflects the hostile origin.

This is not theoretical: the pilot deployment shipped without it, and the
`/health` body read `"env":"development"` while the API reflected arbitrary
origins. Setting `NODE_ENV=production` also switches error responses to their
production shape, so re-check `/health` after the change.

### When every API path answers 500

`/` can render perfectly while `/health` and `/api/*` both fail: the frontend
is static files, the API is a function, and only the function can be broken.
Two failures look alike in a browser and mean different things:

| Response body | Meaning | Fix |
|---|---|---|
| `{"error":{"code":"BACKEND_INIT_FAILED","message":"…"}}` | the function started and named the problem — a missing variable, or `api/index.js` could not load the compiled app | read the message; it names the variable or the missing file |
| plain text `FUNCTION_INVOCATION_FAILED`, `x-vercel-error` header | the function died before it could answer: a module-scope throw, or no invocable function at all | Runtime Logs; the first stack frame names the module |

The `x-request-id` response header is the tell between the two: the app sets it
before any route runs, so its absence means the app never started. If the body
is the platform's own 500 *and* that header is missing on every path, the
function is not running this code at all — check that the deployment's build
command finished (a failed build keeps the previous, equally broken deployment
live), then the Runtime Logs.

This deployment spent a day in exactly that state while the API was declared as
a second **service**: the service built, the entry exported the app correctly,
and every request still answered the platform's 500. Moving the API to a plain
function at `api/index.js` — which loads `backend/dist` and reports why if it
cannot — is what made the API reachable.

`npx vercel env ls production` lists what the project actually has, which is
the fastest way to spot a key that was added to `.env` locally but never to
Vercel.

---

## Health

| Endpoint | Meaning | Use for |
|---|---|---|
| `/health/live` | process is up; no I/O | container health check / restart policy |
| `/health` | database + GoTrue reachable, plus version | routing decision, dashboards |

`/health` returns `503` when either dependency is down. Do not point a restart
policy at it — a slow database would cause a restart loop that fixes nothing.

Every response carries `x-request-id`, and every log line includes it. When
someone reports a failure, ask for that id.

---

## Backups

```bash
cd backend
npm run db:backup            # writes backend/backups/<db>-<timestamp>.<ext>
```

`pg_dump` is used when it is installed; otherwise the script falls back to a JSON
snapshot (all rows in `public`, with row counts). **The JSON fallback is a safety
net, not a substitute** — install the PostgreSQL client and set `PG_DUMP` for a
real dump before relying on this.

Copy backups off the machine. A backup on the same disk as the database is not a
backup.

### Restore drill

```bash
cd backend
npm run db:restore -- backups/<file>.json --yes --force
```

Refuses without `--yes`, and refuses again unless `--force` or
`ALLOW_DESTRUCTIVE_RESTORE=1` says the target is disposable: `--yes` confirms
the *file*, not the *database*. For a JSON snapshot it truncates and refills every table
in the file, inside one transaction, with FK triggers suspended and sequences
re-synced afterwards; then it compares row counts to the snapshot.

**Measured on 2026-10-19:** 21 tables, 417 rows, restored in **6 seconds**, counts
verified, demo logins still working afterwards. Re-run this drill quarterly —
a backup that has never been restored is a guess.

---

## Reminders

Every booking queues a **24-hour** and a **2-hour** email in
`reminder_outbox`. The trigger keeps the queue in step with reschedules and
cancellations; the sender only sends what is due.

```bash
cd backend
npm run reminders:dry   # list due rows, change nothing
npm run reminders       # send and mark SENT / FAILED / SKIPPED
```

The schedule lives in the repository: `.github/workflows/reminders.yml` runs
`npm run reminders` every 15 minutes. It is idempotent - a row is only sent
while `status = 'PENDING'` - so a missed or doubled run cannot send twice.
Configure the repository secrets `DATABASE_URL` and the `SMTP_*` pair; without
`DATABASE_URL` the job exits green and does nothing. **Run workflow** on the
Actions tab is the by-hand equivalent. Settings → Reminders shows the queue and
can send a test email.

### SMTP

Set these in `backend/.env.local` (and in the deployment environment):

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=Beauty Alley <no-reply@beautyalley.app>
```

For Gmail: `SMTP_HOST=smtp.gmail.com`, port `587`, `SMTP_SECURE=false`, the
full address as `SMTP_USER`, and a 16-character **app password** (Google
requires 2-Step Verification to create one). Verify before scheduling:

```bash
cd backend
npm run mail:test
```

Without a host — or with a username but no password — the script exits 0 and
leaves the queue **PENDING**; it never pretends to have sent. A client with no email on file is marked `SKIPPED` with
`no email on file`, so the queue does not grow forever.

The email says the appointment time, the reference, the stylist and the
cancellation window. It does not contain a payment link or a pass; those stay
behind the client's sign-in.

---

## HitPay (deposit test)

Settings → **Deposits (test)** opens a HitPay hosted checkout for an amount you
choose. It is deliberately **not** attached to a booking: it proves the account,
the enabled payment methods and the return URL before a deposit becomes a
condition of a reservation.

```
HITPAY_API_KEY=...
HITPAY_MODE=sandbox         # mock | sandbox | live
APP_URL=https://beautyalleyibms.vercel.app
```

- **Sandbox keys come from `https://sandbox.hit-pay.com`**, not the live
  dashboard. HitPay rejects a `live_` key against the sandbox host with
  "You are using a live API key in a sandbox environment".
- **No API key**, or `HITPAY_MODE=mock`: the button opens `/deposit/mock`, which
  says TEST MODE and writes nothing.
- **Sandbox/live key**: the API creates a real payment request and returns
  HitPay's hosted `url`. Sandbox uses `api.sandbox.hit-pay.com`; live uses
  `api.hit-pay.com`. A live key cannot be used on the sandbox host, and a live
  store must finish HitPay verification before it can accept online orders
  (`403 This store is not yet verified`). Until then, keep `HITPAY_MODE=mock`.
- The endpoint is ADMIN-only; it spends the salon's account even in sandbox mode.

## Built-in test gateway (no merchant account)

`HITPAY_MODE=mock` uses a self-hosted gateway. The checkout is a real database
row in `test_payment_requests`; pressing **Pay now (test)** builds a
`payment_request.completed` body, signs it with HMAC-SHA256 over the raw bytes,
and posts it to the same handler HitPay will use:

```
POST /api/v1/webhooks/hitpay
Header: Hitpay-Signature: <HMAC-SHA256 of the raw body, using HITPAY_SALT>
```

Register that URL in HitPay → Developers → Webhook Endpoints with the
`payment_request.completed` event when the account is verified. A bad or
missing signature is a 401; the redirect URL is never trusted.

Nothing in this flow marks a booking paid. The test page says TEST MODE on
every screen and moves no money.

---

## Test database

`npm test` runs against **`beautyalley-test`**, a second Supabase project:

| | |
|---|---|
| Ref | `csfxgyvclrtklkqbguda` |
| Region | Southeast Asia (Singapore) |
| Credentials | `backend/.env.test.local` (gitignored) |
| Schema | 48 migrations + seed, verified 2026-11-04 |
| State | **Paused** by default |

The free plan allows two active projects, and the payroll system needs one. The
test project is therefore kept paused and swapped in only for a test run.

### Running the suite

1. Pause the payroll project (`fwmjwjgeajwpnmxeqbyv`) in the dashboard:
   **Project Settings → General → Pause project**.
2. Resume `beautyalley-test` the same way.
3. Run:
   ```bash
   cd backend
   npm test
   ```
4. Pause `beautyalley-test`, then restore payroll.

Pausing preserves data on both sides. The test project's schema and seed survive
the pause, so `db:setup:test` is only needed on a **fresh** test project.

### Rules

- **Never** point `.env.test.local` at `gmdeielhcddkuziraryl` (BeautyAlley).
  `tests/env.ts` refuses to run if the two URLs resolve to the same database.
- `db:seed:test` passes `--force` because `_load-env.js` has already proved the
  target came from `.env.test.local`. Do not add `--force` to the normal seed.
- `db:setup:test` is destructive: it truncates and reseeds. It is for a
  disposable project only.
- The first full run on 2026-11-04 found two fresh-install gaps that production
  had hidden: migrations `22a` (the four legacy demo services) and `46` (the
  privilege baseline). Both now apply cleanly to an empty project.

---

## Migrations

```bash
cd backend
npm run db:status     # applied / pending / changed
npm run db:plan       # validate + list what WOULD apply, change nothing
npm run db:migrate    # apply
```

- Each file runs in its own transaction.
- Applied migrations are **immutable**: editing one is detected by checksum and
  blocks the run.
- A session advisory lock prevents two runners from interleaving.
- **Rollback is forward-only.** There are no down-migrations. The recovery path
  is: restore the latest backup, then fix forward.

`--reset --yes` drops schema `public` entirely. It exists for local rebuilds and
should never be run against the pilot database.

---

## Destructive scripts

Four things in this repository can delete rows. Each one refuses outright under
`NODE_ENV=production`, and each one needs a second, explicit statement that the
target is disposable.

| Command | What it does | Needs |
| --- | --- | --- |
| `npm run db:seed` | TRUNCATEs 17 tables, rebuilds the catalogue and three demo stylists | `ALLOW_DESTRUCTIVE_SEED=1` or `--force` |
| `npm run db:restore` | Replaces every table in the snapshot | `--yes` **and** (`ALLOW_DESTRUCTIVE_RESTORE=1` or `--force`) |
| `node scripts/reset-demo-data.js --apply` | DELETEs every booking and every non-seeded client | `ALLOW_DEMO_RESET=1` or `--force` |
| `npm test` | Seeds first, via Jest `globalSetup` | a target `tests/env.ts` can prove is not the application's database |

**Deployment runs none of them.** `vercel.json`'s build command compiles the
frontend and the backend; the Dockerfile compiles and prunes; `api/index.js`
only loads the compiled app. There is no `postinstall`, no start-up migration or
seed, and no scheduled SQL job. A redeploy cannot change a row.

### Why `npm test` is on that list

The suite's `globalSetup` calls `scripts/seed.js`, which TRUNCATEs 17 tables -
so a test run pointed at the pilot database deletes every client, booking,
employee, task and attendance row in it, and rebuilds the three demo stylists.
That is what happened on 2026-10-30: `.env.local` pointed `DATABASE_URL` at the
pilot project *and* carried `ALLOW_DESTRUCTIVE_SEED=1`, so the seed's guard
answered "disposable" on behalf of a database that was not. Every `npm test`
wiped it; the symptom looked like the deployed app losing records.

The guard is now positive rather than permissive. `tests/env.ts` refuses the run
unless it can prove the target is separate:

- `DATABASE_URL` must differ from the one in `backend/.env.local`, **and**
- where `.env.local` does not exist (CI), `TEST_DB_HOST` must equal the hostname
  in `DATABASE_URL`. A swapped `TEST_DATABASE_URL` secret is refused, not obeyed.

Run the integration suite from `backend/.env.test.local` pointing at a second
Supabase project. The unit suite (`npm run test:unit`) needs no database and
never touches one - including in teardown.

---

## Incidents

1. **Get the request id** from the user or the response header.
2. **Check `/health`** — it separates database from auth failure.
3. **Read the logs** — one JSON object per line. Failures are `warn`/`error` and
   always logged; successful requests are `info` in production.
4. **If data is wrong**, stop writes before restoring. A restore taken during
   active writes loses the writes after the snapshot.

Process crashes are logged as `process.uncaughtException` /
`process.unhandledRejection` before the process exits non-zero. If you see those,
the cause is in the preceding log lines, not the crash itself.

---

## Secret rotation

Rotate in this order:

1. `SUPABASE_SERVICE_ROLE_KEY`, database password, `SUPABASE_ANON_KEY` — in the
   Supabase dashboard.
2. Redeploy with the new values.
3. `QR_SIGNING_SECRET` **last**, and deliberately: it invalidates every
   outstanding arrival pass, so guests holding a printed pass will need a new one.

`KIOSK_PIN_PEPPER` sits outside that order because it is not part of the
boot path: rotating it invalidates every door PIN and nothing else. Do it out of
hours, then re-issue PINs from the Team page — the old ones stop working the
moment the new value is live.

Rotating the Supabase JWT secret additionally invalidates every signed-in session.

Record each rotation here, so "was this key ever changed?" has an answer that
does not depend on memory. A rotation with no date and no verifier is a rumour.

| Date | Key | Rotated by | Verified by |
|---|---|---|---|
| _pending_ | `SUPABASE_SERVICE_ROLE_KEY` | — | — |
| _pending_ | demo account password | — | — |

## Deposit policy

Settings → **Deposit policy** turns the obligation on. It is **off by default**;
enabling it does not move money, it records a `booking_deposits` row on every
new booking with status `DUE`, provider `manual`, and reference `DEP-<booking
reference>`.

| Setting | Meaning |
|---|---|
| Amount | One to ten thousand pesos, the same for every booking. |
| If a booking is cancelled | `refund` returns a held deposit; `forfeit_if_late` keeps it only inside the cancellation window; `forfeit` keeps it. |

Settlement rules, applied automatically:

- A **DUE** deposit blocks check-in and the move to `CHECKED_IN`. The desk sees
  `DEPOSIT_DUE` until it is settled.
- **Paid** or **Waive** on the booking row moves a DUE deposit; only a DUE row
  can move, so a double tap cannot settle twice.
- A cancellation settles a PAID deposit to `REFUNDED` or `FORFEITED` by the
  rule above. A staff-forced cancellation always refunds.
- A **no-show** always forfeits. A DUE row on any ended booking becomes
  `WAIVED`, because nothing was ever held.

This is the manual half of deposits. Online payment is still the test surface
above; attaching a gateway checkout to a booking is the next slice.

## Leave and the rota

Leave is a request with an answer, not a row the owner types and forgets.
`time_off.status` carries the whole model: `PENDING` is a question nobody has
answered, `APPROVED` and `DECLINED` are answers, and both record who gave it
and when (`decided_by`, `decided_at`, `decision_note`).

| Who | Can do |
|---|---|
| Stylist (EMPLOYEE) | Ask for leave **against their own roster record**; withdraw it while it is still pending; read their own entries. |
| Front desk (CONCIERGE) | Read the rota board. Cannot ask for someone else's leave, cannot answer one. |
| Owner (ADMIN) | Everything above for anyone, plus approve or decline. An entry the owner creates is approved on the spot — typing it *is* the decision. |

Where it lives:

- **Team → Leave** (owner): the requests waiting for an answer, then a
  fourteen-day strip. Each cell reads *available / scheduled*; a day turns clay
  when approved leave leaves nobody scheduled on the floor.
- **Attendance → Your leave** (anyone with a roster row): the request form and
  the status of everything from today onward.

The coverage numbers come from `get_leave_board(from, to)` (migration 54), not
from subtracting two lists in the browser, so the desk and the owner cannot
disagree about Thursday. "Available" is the active stylists whose weekly
pattern includes that weekday, minus those of them on **approved** leave. A
pending request is counted separately and does not reduce cover until somebody
answers it.

Endpoints: `GET /employees/leave?from&to` (DESK), `POST
/employees/:id/time-off` (OPERATIONS, self or owner), `POST
/employees/:id/time-off/:leaveId/decision` (ADMIN), `DELETE
/employees/:id/time-off/:leaveId` (OPERATIONS, self-while-pending or owner).

### What an approval does to the diary

Only **approved** leave closes the calendar. A pending request changes nothing
about what can be booked — a stylist cannot stop the salon selling their
Saturday just by asking for it. The four functions that guard the booking
engine (`create_booking`, `get_available_slots`, `reassign_booking_employee`
and the `enforce_employee_time_off` trigger) check `status = 'APPROVED'`
since migration 55.

Approving is never blocked by existing bookings, because the owner's decision
is the business decision. What happens instead is that the clash is made
visible, twice:

- The request row carries **"N booked"** before the decision, so the owner can
  see what approving would cost while there is still time to decline.
- Anything left inside **approved** leave is listed under *Appointments inside
  approved leave*, with a link straight to the booking. Cancelled and no-show
  rows are excluded — they are already out of the diary. `CHECKED_IN` and
  `IN_SERVICE` are included, because a guest at the desk is the most expensive
  thing to find out later.

Nothing is cancelled automatically. Moving or calling the guest stays a human
act.

### Where the weekly pattern is edited

**Team → a stylist's card → Show details → Weekly hours.** Seven days, each
holding one or more windows; a day with no window is *Closed*. A second window
on the same day is a split shift, which is why the editor shows every window
rather than the first one: the write is a replace, so anything the screen
omits is deleted.

- **Saving replaces the whole week** through `PUT /employees/:id/working-hours`
  (ADMIN). The server validates ordering and overlap before it deletes, so a
  bad draft cannot leave a stylist with no rota at all.
- **An empty week is legal and means unbookable.** `get_available_slots`
  inner-joins `working_hours`, so no windows is not "offered with no times" —
  the stylist is absent from the grid. The editor refuses to save that state;
  deactivating the stylist is the honest way to take them off the floor.
- **A new stylist starts on the house pattern** — Monday to Saturday,
  09:00–18:00 — written by `POST /employees`. That is the branch's opening
  hours, not a guess about the person.
- **Saving re-reads the leave board**, because its *scheduled* count is
  "whose pattern includes this weekday". A rota change and a stale coverage
  strip would contradict each other.

Reading the pattern is `GET /employees/:id/working-hours` (ADMIN). It is a
separate call because the public `GET /employees/:id` omits `workingHours` on
purpose — hours are an internal scheduling detail with no RLS policy for a
browser.

## Door PINs

The kiosk by the entrance admits a guest only after a member of staff confirms
with a PIN. **Team → a stylist's card → Show details → Door PIN** sets, changes
and removes it; the read is `GET /employees/:id/pin` and the writes are
`PUT`/`DELETE` on the same path, all ADMIN.

The PIN is **not a password and is not stored as one.** It is a blind index:

    pin_lookup = HMAC-SHA256(KIOSK_PIN_PEPPER, "staff-pin:" || pin)

A PIN identifies *who typed it*, from the digits alone — the tablet knows no
employee id, and letting it name one would let a stolen device admit guests
under any name it liked. Looking a secret up by value rules out a per-row salt,
so the pepper stands in for it.

What follows from that, operationally:

- **`KIOSK_PIN_PEPPER` must be set before any PIN can be issued.** Without it
  the three PIN endpoints answer `503 CONFIG_ERROR`; everything else runs
  normally. Generate one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- **Rotating the pepper invalidates every PIN at once.** There is no column
  remembering which pepper a row used — keeping the old one forever is worse
  than re-issuing five four-digit numbers. Do it out of hours and expect to
  re-set every PIN.
- **A PIN is unique across staff**, because it has to resolve to one person. A
  collision is `409 PIN_TAKEN`; the message does not name the holder.
- **No endpoint can read a PIN back**, including for the owner. A forgotten PIN
  is replaced, not recovered.
- **A PIN can be set for a deactivated stylist** — a person may be given one
  before their first shift. Whether a *deactivated* person can actually admit
  someone is decided when the arrival is recorded, not here.

Wrong PINs are throttled **per device**, not per person: five in a row start a
60-second wait that doubles to a 15-minute ceiling, and a correct PIN clears the
count. Locking a person instead would let anyone in the lobby lock a stylist out
of their own PIN.

Still missing: a request does not email anyone.
