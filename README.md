# The Beauty Alley — Salon Operating System

A booking, front-desk and floor-management system for a luxury salon and spa.

Two apps in one repository:

| | Where | Port | What it is |
| --- | --- | --- | --- |
| **API** | `backend/` | `4000` | Express + TypeScript over Supabase (Postgres, Auth, RLS). JSON only. |
| **App** | repo root | `5173` | React 18 + Vite + TypeScript. The public site and the staff console. |

Design rationale for the backend lives in [`backend/DESIGN.md`](./backend/DESIGN.md);
API-level detail in [`backend/README.md`](./backend/README.md).

---

## Running it

Both servers start explicitly. The app will look broken — connection refused,
not a 401 — if the API is not up.

```bash
# terminal 1 — the API
cd backend
npm install
npm run build
npm start                   # http://127.0.0.1:4000

# terminal 2 — the app
npm install
npm run dev                 # http://127.0.0.1:5173
```

Check the API before blaming the frontend:

```bash
curl http://127.0.0.1:4000/health
# {"status":"ok","env":"development","checks":{"serviceRoleKey":true,"timezone":"Asia/Manila","database":"ok"}}
```

`GET /` and `GET /api/v1` serve a machine-readable index of every endpoint.
Every API route lives under `/api/v1`; only `/health` and `/` sit at the root.

### First-time database setup

```bash
cd backend
npm run db:migrate     # apply the SQL migrations
npm run db:seed        # deterministic fixtures: services, employees, clients
```

---

## Deploying

One Vercel project serves both apps. [`vercel.json`](./vercel.json) keeps the
Vite frontend at the repository root and exposes the Express API as a single
function, [`api/index.js`](./api/index.js), which loads the app compiled to
`backend/dist`. `/api/*` and both health endpoints are rewritten to it. The
browser only ever talks to the project's own origin, so there is no
`VITE_API_URL` to keep in sync.

The project's build command compiles both halves, which is why the API is not
built by a framework preset:

```bash
npm run build && cd backend && npm ci --include=dev --no-audit --no-fund && npm run build
```

`--include=dev` is required. Once `NODE_ENV=production` is set in the project,
a plain `npm ci` omits devDependencies — including `typescript` and
`@types/express` — and the backend build fails with a wall of TS7016 errors.
The setting belongs in the deploy environment; the build still needs its tools.

It used to be two **services** in the same project. That model built the frontend
correctly but never produced an invocable API function — every `/api/*` and
`/health` request answered the platform's bare `FUNCTION_INVOCATION_FAILED`,
whatever the entry file exported. A function in `api/` is the platform's plain,
long-standing path and does not depend on a beta feature or a framework preset.

1. Import the repository in Vercel. Leave the root directory at the repository
   root; the build command and rewrites come from `vercel.json`.
2. Add the [environment variables](./docs/runbook.md#required-environment-variables)
   under **Settings → Environment Variables**. `ALLOWED_ORIGINS` is **required**
   on Vercel: the API refuses to boot in production without it or
   `SERVE_APP=true`, and `SERVE_APP` stays off here because the frontend is
   served by the same project. Set it to the production origin,
   `https://<project>.vercel.app`.
3. Deploy — the dashboard, or `vercel --prod` from a terminal.

### Console on its own origin

The public site is the booking site — no "open console" link, no staff sign-in
in the nav or the footer. The console is published on its own origin instead:

1. Add a second domain to the same project (**Settings → Domains**), e.g.
   `beautyalley-console.vercel.app`.
2. Set `VITE_CONSOLE_URL` to that origin (no trailing slash) and redeploy.
   The build is shared, so one deployment serves both hosts.
3. Add the console origin to `ALLOWED_ORIGINS` as well, comma-separated:
   `https://<public>,https://<console>`. The allow-list is exact-match, and
   the console calls `/api` from its own origin.

With `VITE_CONSOLE_URL` set, `/app/*` on the public origin is forwarded to the
console origin before React mounts ([`src/main.tsx`](./src/main.tsx)), and the
signed-in header links to the console absolutely. Leave the variable unset for
local development and single-origin previews — everything then behaves as one
site.

### What lives where

| URL | Serves | Notes |
|---|---|---|
| `/` | public home | booking only; no console entry |
| `/login` | client sign-in | also the staff sign-in *on the console origin* |
| `/app/*` | console | forwarded to `VITE_CONSOLE_URL` when set; else `RequireAuth` → `RequireArea` |
| `/api/v1/*` | JSON API | role-gated server-side |
| `/health` · `/health/live` | health | readiness vs liveness |

`/` and `/login` are separate links on purpose: a visitor books without an
account, and staff enter through the console door. Neither is a redirect of the
other. Both `/login` and `/app/bookings` are real deep links — the frontend
service rewrites unknown paths to `index.html`, so a bookmark or a shared link
opens the right screen instead of a 404.

### Self-hosting instead

The [`Dockerfile`](./Dockerfile) builds one image that serves both apps on port
4000 with `SERVE_APP=true` — same code, one origin, no Vercel. Use it when the
API needs to live on the salon's own host; health checks and backups in the
[runbook](./docs/runbook.md) apply either way.

---

## Accounts

Four logins, one per role, are listed in [`accounts.json`](./accounts.json) by
email, name and linked employee/client row. **No password lives in this
repository** — they are set once by the owner and rotated from the Supabase
dashboard or with the service-role key. Scripts that need to sign in read
`ACCOUNT_PASSWORD` from the environment:

```bash
ACCOUNT_PASSWORD='…' node scripts/verify-atomicity.js
```

The login page no longer offers demo quick-fill, and `vite build` cannot emit a
credential it was never given.

### Changing a password

The console is the normal path now:

- **Settings → My account** — any signed-in user changes their own password.
  The current password is required, so a session left open on a shared terminal
  is not enough on its own.
- **Settings → Account recovery** — an ADMIN sets a password for any account by
  email, including the four demo logins. No mail link is sent; the owner hands
  the new password over in person.

`accounts.json` stores emails, names and linked rows only. It never stores a
password.

### Business settings

Two owner-only sections beyond passwords:

- **Booking rules** — the client cancellation cutoff (hours) and the arrival
  window (minutes). The booking service reads them on the next cancellation or
  pass, so a change needs no deploy. `CANCELLATION_WINDOW_HOURS` and
  `QR_CHECKIN_WINDOW_MINUTES` are now fallbacks for a database without the row.
- **Deposits (test)** — opens a deposit checkout. Mock mode uses a built-in
  test gateway with a real hosted page and a signed webhook; a HitPay key opens
  HitPay's page instead. Not attached to a booking; no money moves.
- **Payments** — which of the five providers the desk offers, and which is the
  default. This records the choice; it does not connect a processor.
- **Reminders** — every booking queues a 24-hour and a 2-hour email. Gmail
  SMTP is configured and an hourly automation runs `npm run reminders`.
  Settings → Reminders shows SMTP status, queue counts and a test-email button.
  See [Reminders](./docs/runbook.md#reminders).

---

## What each role sees

Access is enforced **server-side**; the navigation merely avoids offering links
that would 403. The role comes from `public.profiles.role`, never from the JWT,
so a demotion takes effect immediately rather than when a token expires.

This table is **the console** — the areas `SCOPE` in
[`src/auth/AuthProvider.tsx`](./src/auth/AuthProvider.tsx) grants each role. It is
checked in CI by `npm run check:roles` against
[`tools/roles.expected.json`](./tools/roles.expected.json), so the table and the
code cannot drift apart silently.

| Area | Owner | Front desk | Therapist | Client |
| --- | :-: | :-: | :-: | :-: |
| Overview | ✓ | ✓ | ✓ | |
| Bookings | ✓ | ✓ | ✓ | |
| Arrivals | ✓ | ✓ | ✓ | |
| Task board (assign work) | ✓ | ✓ | | |
| My tasks (do the work) | | | ✓ | |
| Attendance | ✓ | | ✓ | |
| Clients | ✓ | | | |
| Promo codes | ✓ | ✓ | | |
| Services | ✓ | | | |
| Employees | ✓ | | | |
| Insights | ✓ | ✓ | | |
| Settings | ✓ | ✓ | ✓ | ✓ |
| My bookings | | | | ✓ |

These are display names. The internal role codes stay `ADMIN`, `CONCIERGE`,
`EMPLOYEE` and `CLIENT`; the API guards and `SCOPE` did not change with the
labels.

An employee who navigates directly to `/app/tasks` gets a polite refusal, and
the API refuses them regardless. All three staff roles can open `/app/arrivals`;
the default mode is scan-and-confirm, so a mis-scan cannot admit the wrong guest.

### The API is deliberately wider than this table

Two areas are narrower here than the endpoints behind them, and that is not
drift to be "fixed" by widening `SCOPE`:

- **Attendance.** `GET /attendance` is `OPERATIONS` and scopes itself per caller
  in the service — a therapist sees their own row, the front desk sees the floor.
  The console simply does not offer the desk the screen, because a clock is a
  person's own record.
- **Clients.** `GET /admin/clients` is `DESK`, so the Insights aggregates work
  for the front desk. Everything that *writes* a client record sits behind the
  blanket `ADMIN` guard below it.

---

## Features

### Public site
- **Landing page** with the video hero, unchanged.
- **Treatment catalogue** — search, four categories, detail modal, prices.
- **Booking** — three steps, guest or signed in, promo codes.
- **Arrival pass** — a printable page with a per-reservation QR code.

### Console
- **Attendance** — time in / time out, hours worked, history, date filters.
- **Task board** — the concierge assigns work; statuses, priorities, due dates.
- **My tasks** — the employee's own list, with completion notes.
- **Arrivals** — scan and confirm, or quick check-in, with a manual reference fallback.
- **My bookings** — a client can move or cancel their own appointment inside the policy; the row updates from the server response, not a stale refetch.
- **Bookings, clients, promos, employees, Insights, reports.**

---

## The treatment catalogue

Treatments are grouped by a **subcategory row** in the database, not by a list in
the code — so a treatment the salon adds tomorrow lands in the right group with
no code change.

| Category | What it is |
| --- | --- |
| **Haircut & Salon Services** | The salon floor. These carry no subcategory. |
| **IV Drips** | Korean Glass Skin ₱1,800 · Korean Youthful Glowing Skin ₱1,600 · Luminous ₱1,400 · Immune Booster ₱1,500 |
| **Beauty Shots** | Anti-Aging (Placenta) ₱1,200 · Rejuvenating (Collagen) ₱1,200 |
| **Add-on Services** | Placenta ₱500 · Collagen ₱500 · Vitamin C ₱300 · Multivitamins (B12) ₱300 |

**Ingredients are shown only when the salon has confirmed them.** The API returns
`ingredients` *and* `ingredientsVerified`; the Luminous Drip has no confirmed
formulation, so the catalogue says the formulation is being confirmed rather
than inventing one. Both the API and the UI refuse to guess.

**Injectable and IV treatments are marked "Consultation".** Their detail modal
states plainly that they are given by a nurse after a consultation, that they
are not suitable for everyone, and what to disclose — and that nothing on the
page is medical advice.

---

## Design system

One set of CSS variables drives both identities, in `src/index.css`:

- **Public site** — emerald `#1B4D3E`, ivory, champagne; Cormorant Garamond for
  headings.
- **Console** — blush, champagne gold, ivory, beige and warm neutrals; **Plus
  Jakarta Sans for everything**, headings included.

The console palette is applied by putting a `console` class on `document.body`
while a dashboard route is mounted. Because the font families and shadow tints
are themselves CSS variables, that single class re-skins every dashboard
component without any of them knowing the palette exists. It is on `body`
rather than a wrapper so Radix portals (the mobile sidebar sheet) inherit it too.

---

## Data and persistence

- Existing tables and relationships are reused throughout; the new features add
  **two tables** (`attendance`, `tasks`) and extend two DTOs. Nothing is
  duplicated into a second store.
- **`localStorage` is never cleared** to make a feature work. It holds exactly
  one key — the session (`alley.session.v1`) — written by `src/auth/session.ts`.
- `attendance` and `tasks` **survive a refresh** because they are database rows,
  not client state.
- **Loyalty is derived, never stored.** `v_client_loyalty` counts completed
  bookings, so cancelling an appointment self-corrects.
- **Money is integer minor units** (`…Cents`) end to end; it is divided only at
  the moment of display. All timestamps are `Z`-suffixed UTC, rendered in the
  branch timezone (`Asia/Manila`).

---

## Testing

`npm test` runs against a **second Supabase project**, configured in
`backend/.env.test.local` (gitignored). It refuses to run without it: the suite
truncates seventeen tables, and pointing it at the salon's database would delete
the branch's data.

```bash
cd backend
cp .env.test.example .env.test.local   # fill in the test project's four values
npm run db:setup:test                  # migrations + seed, once
npm test                               # 460 tests, 23 suites
npm run test:unit                      # 187 tests, no database
npm run smoke                          # end-to-end checks over real HTTP (needs a running server)
npm run db:verify                      # 51 checks against the application database
npm run verify:arrival                 # book -> pass -> confirm arrival (needs a running server)
npm run typecheck
```

```bash
# frontend
npx tsc --noEmit && npm run build
node .verify/verify-console.cjs   # drives every console page in a real browser
```

CI (`.github/workflows/ci.yml`) runs the secret scan, both builds, the unit suite
and a container build on every pull request. It also **fails if the demo password
appears anywhere in `dist/`** — that regression is worth a dedicated check,
because it is invisible in code review and obvious to anyone who greps the
bundle.

> The free Supabase plan allows two active projects. `beautyalley-test` is kept
> **paused** so the payroll project can stay active. To run the suite, pause
> payroll, resume `beautyalley-test`, run, then swap back — see
> [Test database](./docs/runbook.md#test-database).

`npm run db:verify` books real slots inside a transaction that rolls back, so
run it during branch hours. Its QR section depends on a bookable slot and stops
with `OUTSIDE_WORKING_HOURS` after the salon closes; that is the script's time
dependency, not a failed check.

---

## Operations

[`docs/runbook.md`](./docs/runbook.md) is the operational reference: deployment,
environment variables, health checks, backups and the restore drill, migration
policy, destructive-script guards, incidents and secret rotation. It is not
duplicated here — one copy, so it cannot drift.

Health is split deliberately:

| Endpoint | Checks | Use for |
|---|---|---|
| `/health/live` | process only, no I/O | container health check |
| `/health` | database + auth + version | routing, dashboards |

Every response carries an `x-request-id` header, and every log line includes it,
so a reported failure can be traced without guessing.

---

## Known limitations

These are the things this prototype does **not** do. None of them is hidden in
the code.

**Security / production**
- The demo password was committed in an earlier revision and still exists in git
  history. `accounts.json` no longer stores it; rotate the password in Supabase
  and keep the new one in a password manager.
- QR passes are long-lived links and the scanning device is trusted. Production
  needs short expiry windows, device binding, and an audit trail of which device
  scanned what. (The pass itself already carries no personal data — only a
  token id, a booking id and an expiry.)
- The mobile camera requires `https://` or `localhost`; browsers block camera
  access on plain HTTP over a network address.
- No rate limiting on the QR scan endpoint.

**Data**
- Treatment **durations** (60 / 30 / 15 minutes) are placeholders pending the
  salon's real timings.
- The four deactivated salon services still need real prices and durations.
- **Treatment photography is placeholder imagery**, resolved from the treatment
  name and category rather than stored per row.
- Attendance has no leave-request or approval workflow — the desk files leave
  directly. There is no rostering UI for `working_hours`.
- A confirmed arrival is attributed to the concierge through the **audit log**
  (`booking.checked_in`, actor = their profile). A concierge has no `employees`
  row — reception is not a service provider — so `checkins.staff_id` is `null`
  for a desk check-in. If the salon wants the desk named on the check-in row
  itself, the concierge accounts need `employees` rows.
- No payroll, no payslip export, no overtime rules.
- Tasks have no recurring schedule, no attachments and no notifications.

**Deliberately not automated**
- Nobody is marked **late** or **absent** automatically. `minutesLate` is only
  computed against a rostered shift when one is configured; a day with no
  record stays empty, because absence is a business decision rather than
  something a clock can know.
- A scanned QR that matches no reservation **never creates one**. Walk-ins go
  through the normal booking flow.
- **Confirming an arrival does not complete the service and does not take a
  payment.** It records the check-in and nothing else.
