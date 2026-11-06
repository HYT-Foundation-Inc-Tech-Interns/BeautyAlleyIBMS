# Roles and areas

The console has one entry per area. `SCOPE` in
[`src/auth/AuthProvider.tsx`](../src/auth/AuthProvider.tsx) decides which role
sees which entry; the API decides whether the call succeeds. This table is the
contract, and `npm run check:roles` fails CI if `SCOPE` and
[`tools/roles.expected.json`](../tools/roles.expected.json) disagree.

| Area | One purpose | Owner | Front desk | Therapist | Client |
|---|---|:-:|:-:|:-:|:-:|
| `overview` | The landing page: today's operations for staff, the business summary for the owner | ✓ | ✓ | ✓ | |
| `bookings` | The run sheet and the reservation record | ✓ | ✓ | ✓ | |
| `clients` | Client profiles, visit history and retention | ✓ | | | |
| `promos` | Discount codes, caps and approvals | ✓ | ✓ | | |
| `services` | The service menu, its prices and durations | ✓ | | | |
| `employees` | Team records, qualifications and rotas | ✓ | | | |
| `arrivals` | Scan a pass, confirm the guest, check in | ✓ | ✓ | ✓ | |
| `tasks` | Assign work and follow it through | ✓ | ✓ | | |
| `my-tasks` | The floor's own worklist | | | ✓ | |
| `attendance` | Clock in, clock out, hours worked — and your own leave | ✓ | | ✓ | |
| `insights` | Performance: revenue, utilisation and retention | ✓ | ✓ | | |
| `settings` | Your own password; payment methods for the owner | ✓ | ✓ | ✓ | ✓ |
| `my-bookings` | A client's own appointments and passes | | | | ✓ |

These are display names. The internal codes stay `ADMIN`, `CONCIERGE`,
`EMPLOYEE` and `CLIENT`; every API guard and `SCOPE` entry is unchanged.

## Where the API is deliberately wider than the console

Two areas are narrower in the console than the endpoints behind them. This is
a product decision, not drift:

- **`attendance` for the desk.** `GET /attendance` is `OPERATIONS` and scopes
  itself per caller. The console does not offer the desk the screen, because a
  clock is a person's own record.
- **`clients` for the desk.** `GET /clients/search` is `DESK`: reception needs to
  attach a booking to an existing customer. Browsing the client record is
  `/admin/clients`, which is `ADMIN`. The desk has a lookup, not the record.

## Where the console is wider than it was

Three entries were added because the API already permitted them and their
absence produced dead ends:

- **`tasks` for ADMIN.** `POST /tasks` is `DESK`, and `DESK` includes `ADMIN`.
  The owner could not open the board they were allowed to write to.
- **`arrivals` for all three staff roles.** `POST /qr/check-in` is `OPERATIONS`.
  The console used to split the door into two screens and hide one from the
  floor; Phase 2 merged them, so the desk and the floor share one surface with
  two modes.

`my-tasks` was deliberately **not** given to ADMIN: `/tasks/mine` resolves the
caller's employee row, and an owner has none.
