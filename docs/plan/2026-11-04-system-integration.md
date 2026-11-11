# System Integration Plan — The Beauty Alley

**Date:** 4 November 2026
**Scope:** the existing repository only. No rewrite, no new backend, no multi-tenancy.
**Goal:** every surface has one job, every role can reach the surfaces its API already permits, and the screens share one data layer instead of nineteen hand-rolled ones.

**Status, 4 November 2026:** Phase 0 complete. Phase 1 complete in code and on the live deployment (CORS closed, pass window corrected, role map fixed). The test database now exists: `beautyalley-test` ran the full suite at **460/460**, and is kept paused between runs to stay inside the free plan. The only Phase 1 item still open is secret rotation, which needs the dashboard.

Also shipped the same day, ahead of Phase 2: a Settings page (own-password change, admin account recovery, payment-provider options) and the Board → Insights rename. Phase 2 is now complete: arrivals is one surface with two modes, Overview is the staff Today page, Tasks and My Tasks share one card, and booking/client/pass cross-links work. Next is Phase 3.

**Status, 8 November 2026:** Phase 3 has not started. Three Phase 5 items shipped first because they were the ones blocking daily use: booking deposits (recorded and settled by hand, no gateway), reminder emails from a queued outbox, and leave with an approval, a clash list and a coverage board. The working-hours editor landed on 8 November — the weekly grid no longer caps capacity with no screen to change it. Next is the door kiosk.

**Status, 11 November 2026:** the door kiosk shipped in three slices — a device link, a door PIN, and the screen at `/kiosk` with the owner's provisioning panel in Settings. The owner's daily brief landed the same week as a script and a 07:00 workflow, with no new screen. Phase 5 is complete except deposits, which stay blocked on the provider decision, and one acceptance check still open: the brief has to arrive at 07:00 for five consecutive days before that item can be called done.

---

## 1. The design rule

> One route answers one question for one person. If two routes write the same record the same way, one of them is redundant.

Everything below is judged against that rule. A phase is done when the rule holds for the surfaces it touched, not when the code compiles.

---

## 2. What is actually broken

These are the conflicts found by reading the route table, the role map, and the API guards. They are the reason the system feels like parts that do not connect.

| # | Conflict | Evidence | Consequence |
|---|---|---|---|
| C1 | Two arrival screens do the same job | `CheckIn.tsx` (redeem a pass) and `ScanArrivals.tsx` (scan, then confirm) both end in `POST /qr/check-in` | Staff learn two paths for one event; nav has two doors to one room |
| C2 | The owner cannot assign work | `SCOPE.ADMIN` has no `tasks` or `my-tasks`, but `POST /tasks` is `requireRole(...DESK)` which includes ADMIN | A permitted action has no screen; the owner borrows the desk's account in practice |
| C3 | The desk's role blurb promises client records it cannot open | `SCOPE.CONCIERGE` has no `clients`; `clients.routes.ts` exposes only `GET /clients/search` to DESK; the full record is `/admin/clients` (ADMIN); `ROLE_BLURB` says "client records" | The desk can look a client up during a booking but cannot browse the record, and the copy says otherwise |
| C4 | Two analytics surfaces for the owner | `Overview` renders revenue, completion, no-shows and the curve for ADMIN; `Board` renders the same dashboard endpoint as tiles | The same numbers in two visual languages, neither authoritative |
| C5 | The floor can check in but not scan | `SCOPE.EMPLOYEE` has `check-in`, not `scan-arrivals` | The person at the chair and the person at the door use different screens for the same write |
| C6 | The console ships to every visitor | One Vite build; `/app` is forwarded at runtime by `VITE_CONSOLE_URL` | Public bundle contains all 19 pages; console cannot ship independently |
| C7 | Nineteen pages own their own fetching | `useAsync` + manual `reload()`; no server-state library | Duplicate requests, inconsistent loading/error copy, most of the 11,513 lines |

Two conflicts the deployment adds, already recorded on 30 October:

- `NODE_ENV` is not `production` on Vercel, so CORS reflects any origin with credentials.
- The generic rate limiter uses an in-memory store on serverless, so the real ceiling is unknown.

---

## 3. Phases

Each phase is independently shippable. Do not start the next one until the acceptance checks for the current one pass. Estimates assume one senior full-stack developer; they are ranges, not commitments.

### Phase 0 — Baseline and guardrails

**Effort:** 0.5–1 day. **Risk:** none. **Behaviour change:** none.

**Purpose:** know what "green" means before touching anything, and stop the migration numbering from lying.

Work:

1. Record a baseline: root `npm run typecheck`, backend `npm run typecheck`, `npm test`, `npm run db:verify`, `npm run verify:booking`, `npm run verify:atomicity`.
   - `npm test` truncates `public.bookings`; run `npm run demo:bookings -- --force` afterwards and record that in the baseline file.
2. Write `docs/baseline.md` with the counts and the date. Future phases compare against it.
3. **Migration numbering: document, do not rename.** There are 44 migrations and every full version string is unique, so the ledger is sound. The confusing part is cosmetic: `20261026000041_massage_menu`, then `20261026000042_five_service_menu`, then `20261027000041_early_checkin_override`. Renaming an applied migration changes its version, and the runner would treat it as new and apply it again. Leave the files alone.
4. Add a non-fatal `WARN` to `db:status` when the two-digit suffix stops increasing, so the next author sees the anomaly instead of re-deriving it.
5. Add `docs/adr/` with one decision record: "keep the monolith, split the surface".

**Acceptance:** baseline file exists with real counts; `db:status` warns on the suffix anomaly; no application code changed.

---

### Phase 1 — Safety and truth

**Effort:** 2–3 days. **Risk:** low. **Behaviour change:** two fixes staff will notice.

**Purpose:** the deployment stops trusting every origin, and the role map stops contradicting the API.

Work:

1. **CORS.** Add a boot assertion test for the production guard. Add `npm run smoke:cors` that sends `Origin: https://evil.example.com` and fails if the header is reflected. Set `NODE_ENV=production` and `ALLOWED_ORIGINS` in Vercel (this part needs your dashboard access).
2. **Secrets.** Rotate the Supabase service-role key and the demo password. CI already runs gitleaks over full history (`.github/workflows/ci.yml`), so the scan exists; what is missing is the rotation itself and a dated record of it in the runbook.
3. **Rate limit.** Introduce `RATE_LIMIT_STORE` (`memory` | `redis`). Default stays memory for local; production must choose. Document the real ceiling either way.
4. **Pass validity.** Make the pass display the window the server enforces, `start − 60 min` to `end`. Keep the signature expiry as transport only. One test asserts the copy matches the constants in `check_in_booking`.
5. **Role truth.** Fix `SCOPE`:
   - `ADMIN` gains `tasks` (the API already allows it; the owner could not open the board they could write to).
   - `EMPLOYEE` gains `scan-arrivals` (the API already allows it; the floor could check in but not scan).
   - `CONCIERGE` does **not** gain `clients`: `Clients.tsx` reads `/admin/clients`, which is ADMIN. The desk has `GET /clients/search` for attaching a booking to an existing customer. The misleading blurb ("client records") is corrected to "client lookup" instead of widening the permission.
6. **Role test.** Add a test that every `Area` has at least one nav item and every nav item maps to an API route the role may call. This is the guard against future drift.

**Acceptance:** `smoke:cors` fails against the old config and passes against the new one; `npm run check:roles` fails if `SCOPE` drifts from the documented matrix; unit tests green.

**What I need from you:** Vercel project access for step 1, Supabase dashboard access for step 2.

---

### Phase 2 — One purpose per surface

**Effort:** 1.5–2 weeks. **Risk:** medium (routes move). **Behaviour change:** visible.

**Purpose:** make the navigation match the jobs, and remove the duplicate doors.

Work:

1. **Write `docs/ia.md` first.** A table of every route: path, one-line purpose, who owns it, what it writes. If a row cannot be written without "and", the route is doing two jobs.
2. **Merge the arrival surfaces.** New `/app/arrivals` with two modes: *Scan* (camera) and *Code* (paste a reference). One service (`checkInBooking`), one result panel, one permission (`arrivals`). `/app/check-in` and `/app/scan-arrivals` become redirects.
3. **Give Overview one job: today.** It becomes the operational page for every staff role — arrivals due, in progress, running late, unassigned bookings, exceptions. The ADMIN revenue tiles, curve and top treatments move to the Board.
4. **Rename the Board to Insights.** It becomes the only performance surface: revenue, utilisation, retention, no-shows, staff leaderboard. Drag-to-arrange stays; it is the one place that is allowed to be a dashboard.
5. **Unify tasks.** One component, two modes: `assign` (desk) and `mine` (floor). Two routes remain because they are two jobs, but they share one hook and one row component. The nav shows only the mode the role can use.
6. **Rename the catalogue screen.** Console `Services` becomes **Service menu** so it is not confused with the public `/services` page.
7. **Regroup the nav by job:** Today · Bookings · Clients · Team · Work · Insights · You. One group per job, no group with a single orphan.
8. **Cross-link the records.** Booking row → client profile; client → their bookings; booking → its pass; task → the booking it belongs to. Links are the "connect" part; without them the modules are islands.

**Acceptance:** `docs/ia.md` has no route with two purposes; no two routes write the same record the same way; old URLs redirect; every nav item is reachable by its role without a 403; a walkthrough of each role's day uses only that role's nav.

---

### Phase 3 — Connect the data

**Effort:** 2 weeks. **Risk:** medium. **Behaviour change:** faster screens, consistent errors.

**Purpose:** one data layer, so a change in one place updates every screen that shows it.

Work:

1. Add TanStack Query with a query-key factory (`bookings.today()`, `clients.detail(id)`, `tasks.mine()`).
2. Migrate in this order, one page per commit: Bookings → Clients → Team → Service menu → Tasks/MyTasks → Insights → Overview → NewBooking.
3. Delete `useAsync` when the last page migrates. No page calls `reload()` manually.
4. Mutations invalidate by key; optimistic updates only for status changes that are already idempotent.
5. Add a route-level error boundary and one toast primitive. Map `ApiError.code` to copy in one file.
6. Decompose the five largest pages into `features/<domain>/` while migrating them: Overview 1,372 → target under 400; Board 902; Team 887; NewBooking 872; Bookings 698.

**Acceptance:** zero `reload()` calls; no page over 400 lines; every mutation ends in a toast; a thrown render error shows a recoverable screen; loading, empty and error states use one pattern.

---

### Phase 4 — Separate the console

**Effort:** 1.5 weeks. **Risk:** high (build and deploy change). **Behaviour change:** none, but two deploys.

**Purpose:** stop shipping staff screens to guests, and let the console ship without touching the booking site.

Work:

1. Convert to npm workspaces: `apps/public`, `apps/console`, `packages/api-types`, `packages/tokens`.
2. Move the public pages and the console pages; share the API client and the type definitions.
3. Two Vercel projects from one repository, each with its own root directory and build command.
4. Keep the `/app` redirect for old links; remove it once analytics show no traffic.
5. Public bundle check: fail the build if a console-only module is imported.

**Acceptance:** public bundle contains no console page code; both deploys pass the smoke checks; the test suite is green; a console-only release does not rebuild the public site.

---

### Phase 5 — New capability, smallest first

**Effort:** 2–4 weeks, item by item. **Risk:** medium. **Behaviour change:** new surfaces.

**Purpose:** add the three things the audit says are missing, in the order that protects revenue.

Work:

1. **Working-hours editor.** `PUT /employees/:id/working-hours` already exists; the console has no screen. Build the weekly grid, validate overlaps, show the effect on bookable slots. This silently caps capacity today.
2. **Door kiosk.** A separate, locked-down app: scan the pass, confirm the name, seat the guest, notify the stylist. Device token plus four-digit staff PIN. It is the smallest possible second app and the pilot for Phase 4's architecture.
3. **Owner's daily brief.** A scheduled query and a message: revenue against target, chair-hour utilisation, rebookings, no-shows, one anomaly. No new UI.
4. **Deposits.** Blocked on a payment provider decision (GCash/Maya/card). Do not start until the provider and the refund policy are chosen.

**Acceptance:** a part-time rota changes availability immediately; a guest can be admitted at the kiosk end-to-end; the brief arrives at 07:00 for five consecutive days.

---

### Phase 6 — Harden (ongoing)

- Error tracking with a request ID in every error envelope.
- Uptime check on `/health` that pages someone.
- A rehearsed restore: monthly, against a scratch project, with the recovery time recorded.
- Accessibility: 44 px targets, visible focus, Filipino copy on floor-facing screens.
- Data protection: consent, retention, export and deletion for client records (RA 10173).

---

## 4. Execution protocol

Every phase follows the same loop, so progress is visible and reversible.

1. **Branch** per phase: `phase-1-safety`, `phase-2-ia`.
2. **Change in small commits**, one purpose per commit.
3. **Checks before saying done:** root typecheck, backend typecheck, `npm test`, `db:verify`, `verify:booking`, `verify:atomicity`.
4. **Restore the demo grid** after `npm test`: `npm run demo:bookings -- --force`.
5. **Update `docs/ia.md` and the changelog** in the same phase, not afterwards.
6. **Demo at the end of the phase**, against the local site, with one account per role.

---

## 5. What I need from you

The CORS fix is done and deployed. What remains is the two things that need a
credential only you hold.

| Item | What I need | How to give it | If you do nothing |
|---|---|---|---|
| Service-role key rotation | A new Supabase secret key, or the old one revoked after you create it | Supabase → Project Settings → API Keys → create a new secret key, then put it in `backend/.env.local` and tell me. I update Vercel from that file and redeploy without printing it. | The old key stays valid |
| Demo password rotation | One new password, at least 12 characters | Put it in `backend/.env.local` as `ACCOUNT_PASSWORD=…`, then run `npm run rotate:demo-password`. It updates all four Auth users and never prints the value. | The leaked password keeps working |
| Integration test database | **Done** — `beautyalley-test` (`csfxgyvclrtklkqbguda`), 48 migrations, 460/460 tests | Kept paused; swap with payroll per `docs/runbook.md#test-database` | — |
| Payment provider | GCash, Maya, card, or none yet | Reply with one word | Deposits are deferred; kiosk and daily brief proceed |
| Board → Insights rename | A yes or no | Reply | I keep the name "Board" and only move the analytics |

---

## 6. What this plan deliberately does not do

- **No rewrite.** The booking invariants, the PL/pgSQL functions and the test harness stay.
- **No microservices.** One API over one Postgres remains correct at this size.
- **No multi-tenancy.** There is no tenant column in 18 tables; that is a separate business decision.
- **No native app.** The kiosk and the floor app are PWAs.
- **No new modules before the existing ones have one purpose each.** Adding a fifteenth screen to a console with duplicate doors makes the problem worse, not better.

---

## 7. Phase summary

| Phase | Name | Effort | Ships | Gate |
|---|---|---|---|---|
| 0 | Baseline and guardrails | 0.5–1 day | Baseline doc, migration warning, ADR | Checks recorded |
| 1 | Safety and truth | 2–3 days | CORS fix, pass-window fix, honest role map, role check | Smoke + role check green |
| 2 | One purpose per surface | 1.5–2 weeks | Merged arrivals, Today vs Insights, unified tasks, cross-links | IA table with no dual-purpose route |
| 3 | Connect the data | 2 weeks | Query layer, error boundary, toasts, smaller pages | No manual reloads; no page >400 lines |
| 4 | Separate the console | 1.5 weeks | Two builds, two deploys, shared types | Public bundle has no staff code |
| 5 | New capability | 2–4 weeks | Working hours, kiosk, daily brief | Each item demoed in daily use |
| 6 | Harden | ongoing | Observability, restore drill, a11y | Monthly review |
