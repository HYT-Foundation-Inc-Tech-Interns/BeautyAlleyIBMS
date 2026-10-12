/**
 * The service index, served at `GET /` and `GET /api/v1`.
 *
 * ## Why this exists
 *
 * This service has no HTML surface, so before this module the root was a dead
 * end: pointing a browser at the port returned
 *
 *     {"error":{"code":"NOT_FOUND","message":"No route matches GET /"}}
 *
 * which reads as "the service is broken" when in fact the service is fine and
 * simply has nothing to serve at that address. The index answers the first
 * three questions a caller has - is it up, where is the API, what can I call -
 * without anyone having to read the source or the README.
 *
 * ## Why JSON and not a page
 *
 * The brief for this service is explicit that it is backend-only, with no
 * frontend and no UI. Returning an HTML landing page would misrepresent it as
 * a website and would put a browser-facing surface in a service that is not
 * supposed to have one. A JSON index is service discovery, which is a backend
 * concern; it just happens to be readable in a browser.
 *
 * ## Why the list is hand-written
 *
 * It could be derived by walking the Express router stack, but then it could
 * not carry a description or an auth requirement per route - and "what does
 * this endpoint need?" is the question the index is for. A hand-written list
 * can drift, so `tests/unit/apiIndex.test.ts` asserts that every path below is
 * actually mounted: it issues the request and fails if the response is the
 * router-level `No route matches …` 404. Add a route without adding it here and
 * the index is merely incomplete; add one here that does not exist and the
 * test goes red.
 */

import { env } from "../config/env";

export type ApiAuth = "public" | "optional" | "authenticated" | "STAFF/ADMIN" | "ADMIN";

export interface ApiEndpoint {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Absolute path, so it can be pasted straight into a client. */
  path: string;
  auth: ApiAuth;
  summary: string;
}

export interface ApiGroup {
  name: string;
  endpoints: ApiEndpoint[];
}

/**
 * `optional` means the route works with or without a token but behaves
 * differently: a signed-in client books against their own account, an
 * anonymous visitor books as a guest.
 */
export const API_GROUPS: ApiGroup[] = [
  {
    name: "health",
    endpoints: [
      {
        method: "GET",
        path: "/health",
        auth: "public",
        summary: "Liveness and readiness, including database reachability. Not under /api/v1, so an uptime monitor does not need to know the version.",
      },
    ],
  },
  {
    name: "auth",
    endpoints: [
      { method: "POST", path: "/api/v1/auth/register", auth: "public", summary: "Create a CLIENT account." },
      { method: "POST", path: "/api/v1/auth/login", auth: "public", summary: "Exchange credentials for a session. Rate-limited per address." },
      { method: "POST", path: "/api/v1/auth/refresh", auth: "public", summary: "Exchange a refresh token for a new session." },
      { method: "POST", path: "/api/v1/auth/logout", auth: "authenticated", summary: "Revoke the caller's session." },
      { method: "GET", path: "/api/v1/auth/me", auth: "authenticated", summary: "The caller's profile and role." },
    ],
  },
  {
    name: "services",
    endpoints: [
      { method: "GET", path: "/api/v1/services", auth: "public", summary: "The active catalogue. RLS-enforced, so inactive rows are invisible rather than filtered out." },
      { method: "GET", path: "/api/v1/services/search", auth: "public", summary: "Search the catalogue by name and category." },
      { method: "GET", path: "/api/v1/services/:id", auth: "public", summary: "One service." },
      { method: "POST", path: "/api/v1/services", auth: "ADMIN", summary: "Create a service." },
      { method: "PATCH", path: "/api/v1/services/:id", auth: "ADMIN", summary: "Update a service." },
      { method: "DELETE", path: "/api/v1/services/:id", auth: "ADMIN", summary: "Deactivate a service." },
    ],
  },
  {
    name: "employees",
    endpoints: [
      { method: "GET", path: "/api/v1/employees", auth: "public", summary: "The public 'meet the team' list. Working hours are omitted here." },
      { method: "GET", path: "/api/v1/employees/:id", auth: "public", summary: "One stylist." },
      { method: "POST", path: "/api/v1/employees", auth: "ADMIN", summary: "Create a stylist." },
      { method: "PATCH", path: "/api/v1/employees/:id", auth: "ADMIN", summary: "Update a stylist." },
      { method: "DELETE", path: "/api/v1/employees/:id", auth: "ADMIN", summary: "Deactivate a stylist." },
      { method: "PUT", path: "/api/v1/employees/:id/services", auth: "ADMIN", summary: "Set which services the stylist is qualified for." },
      { method: "PUT", path: "/api/v1/employees/:id/working-hours", auth: "ADMIN", summary: "Replace the weekly shift pattern." },
      { method: "GET", path: "/api/v1/employees/:id/time-off", auth: "STAFF/ADMIN", summary: "Leave entries for a stylist." },
      { method: "POST", path: "/api/v1/employees/:id/time-off", auth: "ADMIN", summary: "Add a leave entry." },
      { method: "GET", path: "/api/v1/employees/:id/performance", auth: "ADMIN", summary: "Utilisation and revenue for a stylist over a window." },
    ],
  },
  {
    name: "availability",
    endpoints: [
      { method: "GET", path: "/api/v1/availability", auth: "public", summary: "Bookable slot grid for a service and date, via a security-definer function." },
    ],
  },
  {
    name: "bookings",
    endpoints: [
      { method: "POST", path: "/api/v1/bookings", auth: "optional", summary: "Create a booking. A guest supplies a name and phone; a signed-in client books against their account." },
      { method: "GET", path: "/api/v1/bookings", auth: "STAFF/ADMIN", summary: "List bookings." },
      { method: "GET", path: "/api/v1/bookings/:id", auth: "optional", summary: "One booking. A guest booking is readable by anyone holding its uuid - the uuid is the capability." },
      { method: "POST", path: "/api/v1/bookings/:id/cancel", auth: "optional", summary: "Cancel. Refused inside the 2-hour window unless forced by staff." },
      { method: "POST", path: "/api/v1/bookings/:id/reschedule", auth: "optional", summary: "Move to a new slot and issue a fresh pass." },
      { method: "GET", path: "/api/v1/bookings/:id/qr", auth: "optional", summary: "Re-issue the signed check-in pass." },
      { method: "PATCH", path: "/api/v1/bookings/:id/status", auth: "STAFF/ADMIN", summary: "Move a booking through the status machine." },
    ],
  },
  {
    name: "me",
    endpoints: [
      { method: "GET", path: "/api/v1/me/bookings", auth: "authenticated", summary: "The caller's own bookings." },
    ],
  },
  {
    name: "qr",
    endpoints: [
      { method: "GET", path: "/api/v1/qr/branch", auth: "STAFF/ADMIN", summary: "Branch descriptor for the scanner. Not a credential - holding it grants nothing." },
      { method: "POST", path: "/api/v1/qr/check-in", auth: "STAFF/ADMIN", summary: "Redeem a pass at the desk. Refuses replays and forged signatures." },
    ],
  },
  {
    name: "promos",
    endpoints: [
      { method: "POST", path: "/api/v1/promos/validate", auth: "optional", summary: "Preview a code against a cart. An unknown code is a 200 with valid:false, not a 4xx." },
      { method: "GET", path: "/api/v1/promos", auth: "ADMIN", summary: "List promo codes." },
      { method: "GET", path: "/api/v1/promos/:id", auth: "ADMIN", summary: "One promo code." },
      { method: "POST", path: "/api/v1/promos", auth: "ADMIN", summary: "Create a promo code." },
      { method: "PATCH", path: "/api/v1/promos/:id", auth: "ADMIN", summary: "Update a promo code." },
      { method: "DELETE", path: "/api/v1/promos/:id", auth: "ADMIN", summary: "Deactivate a promo code." },
    ],
  },
  {
    name: "admin",
    endpoints: [
      { method: "POST", path: "/api/v1/admin/users/staff", auth: "ADMIN", summary: "Create a STAFF or ADMIN account." },
      { method: "GET", path: "/api/v1/admin/dashboard", auth: "ADMIN", summary: "Totals for a date range." },
      { method: "GET", path: "/api/v1/admin/clients", auth: "ADMIN", summary: "Client list with lifetime value." },
      { method: "GET", path: "/api/v1/admin/clients/export.csv", auth: "ADMIN", summary: "The client list as a CSV attachment." },
      { method: "GET", path: "/api/v1/admin/clients/:id", auth: "ADMIN", summary: "One client." },
      { method: "PATCH", path: "/api/v1/admin/clients/:id", auth: "ADMIN", summary: "Update a client." },
      { method: "DELETE", path: "/api/v1/admin/clients/:id", auth: "ADMIN", summary: "Deactivate a client." },
      { method: "GET", path: "/api/v1/admin/bookings", auth: "ADMIN", summary: "Cross-employee booking list." },
      { method: "GET", path: "/api/v1/admin/employees", auth: "ADMIN", summary: "Employee list including inactive." },
      { method: "GET", path: "/api/v1/admin/promos", auth: "ADMIN", summary: "Promo list including inactive." },
      { method: "GET", path: "/api/v1/admin/audit-logs", auth: "ADMIN", summary: "The append-only audit trail." },
    ],
  },
];

export interface ApiIndex {
  service: string;
  version: string;
  env: string;
  /** Says plainly what this address is, so a browser visitor is not misled. */
  note: string;
  branchTimezone: string;
  health: string;
  baseUrl: string;
  auth: string;
  errors: string;
  endpointCount: number;
  groups: ApiGroup[];
}

export function buildApiIndex(): ApiIndex {
  return {
    service: "Beauty Alley Booking API",
    version: "1.0.0",
    env: env.nodeEnv,
    note:
      "This is a JSON API and has no HTML page at any address. " +
      "Everything below is called over HTTP and returns { data } on success or { error } on failure. " +
      "The salon web app is a separate front end and is not served from this port.",
    branchTimezone: env.branchTimezone,
    health: "/health",
    baseUrl: "/api/v1",
    auth:
      "Send a session token as `Authorization: Bearer <access_token>`. " +
      "'public' needs no token; 'optional' changes behaviour when one is present; " +
      "'authenticated' needs any signed-in account; 'STAFF/ADMIN' and 'ADMIN' are role-gated.",
    errors: "Every failure is { error: { code, message, details? } } for any status.",
    endpointCount: API_GROUPS.reduce((n, g) => n + g.endpoints.length, 0),
    groups: API_GROUPS,
  };
}
