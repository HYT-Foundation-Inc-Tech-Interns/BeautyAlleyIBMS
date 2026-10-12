/**
 * The client for the Beauty Alley booking API.
 *
 * ## Why a hand-written fetch layer
 *
 * The API is small, stable and already speaks a uniform dialect: `{ data }` on
 * success, `{ error: { code, message } }` on failure, bearer tokens for auth.
 * A generated client would be more code than this, and the one thing a
 * generated client cannot do is carry the domain knowledge that matters here —
 * which failures are recoverable, and which mean "sign in again".
 *
 * ## The two things this module owns
 *
 * 1. **Token plumbing.** Tokens live in the auth provider, not here, so this
 *    module holds a *port* (`TokenPort`) that the provider binds at mount.
 *    That keeps `api.ts` free of React and free of import cycles.
 *
 * 2. **One silent refresh.** A session that expires mid-session should not
 *    bounce the user to the login screen. On a 401 this retries once with a
 *    fresh token, then gives up. `allowRefresh` makes the retry single-shot —
 *    without it, a permanently-401 endpoint would recurse forever.
 */

import type {
  ApiErrorBody,
  AuditLog,
  AuthUser,
  Availability,
  Booking,
  BookingStatus,
  BranchQr,
  CheckInResult,
  ClientDetail,
  ClientRecord,
  CreateBookingInput,
  Dashboard,
  Employee,
  Health,
  LoginResult,
  Me,
  Paginated,
  Promo,
  PromoType,
  PromoValidation,
  QrState,
  RegisterResult,
  Service,
  ServiceCategory,
  Session,
} from "./api-types";

/**
 * Where the API lives. Overridable with `VITE_API_URL` so a deployment does
 * not need a code change; defaults to the local dev server.
 */
export const API_BASE = (
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://127.0.0.1:4000"
).replace(/\/+$/, "");

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/**
 * A failure the API described. Anything else — DNS, CORS, a dead server —
 * surfaces as `ApiError` with `status: 0` and code `NETWORK`, so callers have
 * exactly one error type to handle rather than two.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** The server could not be reached at all. */
  get isNetwork() {
    return this.code === "NETWORK";
  }

  /** The session is gone — the caller must sign in again. */
  get isAuthFailure() {
    return this.status === 401;
  }

  /**
   * Field-level messages from Zod, when the API rejected a body. The backend
   * returns `details.issues[]` in that case; this flattens it to
   * `{ fieldName: "message" }` for form rendering.
   */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    const issues = (this.details as { issues?: { path?: unknown[]; message?: string }[] })?.issues;
    if (!Array.isArray(issues)) return out;
    for (const issue of issues) {
      const key = Array.isArray(issue.path) ? issue.path.join(".") : "_";
      if (key && issue.message && !out[key]) out[key] = issue.message;
    }
    return out;
  }
}

/* ------------------------------------------------------------------ *
 * Token port
 * ------------------------------------------------------------------ */

export interface TokenPort {
  get(): Session | null;
  /** Return a fresh session, or null if the refresh token is also dead. */
  refresh(): Promise<Session | null>;
}

let tokens: TokenPort = {
  get: () => null,
  refresh: async () => null,
};

/** Called once by the auth provider. */
export function bindTokens(port: TokenPort) {
  tokens = port;
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface RequestOptions {
  /**
   * Typed as `object` rather than `Record<string, …>` on purpose. A TS
   * interface has no implicit index signature, so the richly-typed query
   * shapes below (which are interfaces) would not be assignable to a Record.
   * The endpoint signatures already constrain which keys are legal, so there
   * is no safety lost here — only a cast avoided.
   */
  query?: object;
  body?: unknown;
  /** Attach the bearer token. On by default; harmless when there is none. */
  auth?: boolean;
}

async function send(
  method: Method,
  path: string,
  opts: RequestOptions,
  session: Session | null,
): Promise<Response> {
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.auth !== false && session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  try {
    return await fetch(url.toString(), { method, headers, body });
  } catch (cause) {
    // A browser reports every transport failure as an opaque TypeError, so
    // there is nothing to discriminate on. Wrap it and move on.
    throw new ApiError(
      0,
      "NETWORK",
      `Cannot reach the booking API at ${API_BASE}. Is the server running?`,
      cause,
    );
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? "HTTP_ERROR",
      body?.error?.message ?? `Request failed with status ${res.status}`,
      body?.error?.details,
    );
  }

  /*
   * The API uses two success envelopes, and `meta` is the discriminator.
   *
   *   { data: {...} }                    a single resource — the common case
   *   { data: [...], meta: {...} }       a page — returned by the list
   *                                      controllers, which hand the
   *                                      `paginated()` result straight to
   *                                      `res.json` rather than wrapping it
   *                                      again
   *   { status, env, checks }            /health only, deliberately bare so an
   *                                      uptime monitor does not have to dig
   *
   * Treating these as one shape is what made an earlier version of this client
   * return `undefined` for every list: it took `payload.data` and got the array
   * while the caller expected `{ data, meta }`. So the page object is returned
   * whole, and only a non-paginated body is unwrapped.
   */
  if (payload && typeof payload === "object") {
    const body = payload as { data?: unknown; meta?: unknown };
    if ("meta" in body) return body as T;
    if ("data" in body) return body.data as T;
    return body as T;
  }

  throw new ApiError(res.status, "UNEXPECTED_SHAPE", "The API returned an unrecognised response");
}

async function request<T>(
  method: Method,
  path: string,
  opts: RequestOptions = {},
  allowRefresh = true,
): Promise<T> {
  const res = await send(method, path, opts, tokens.get());

  if (res.status === 401 && allowRefresh && opts.auth !== false) {
    const refreshed = await tokens.refresh();
    if (refreshed) return request<T>(method, path, opts, false);
  }

  return unwrap<T>(res);
}

/** For `text/csv`, which is not wrapped in the JSON envelope. */
async function requestText(path: string): Promise<string> {
  const res = await send("GET", path, {}, tokens.get());
  if (res.status === 401) {
    const refreshed = await tokens.refresh();
    if (refreshed) {
      const retry = await send("GET", path, {}, refreshed);
      if (!retry.ok) throw await asError(retry);
      return retry.text();
    }
  }
  if (!res.ok) throw await asError(res);
  return res.text();
}

async function asError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  let body: ApiErrorBody | null = null;
  try {
    body = text ? (JSON.parse(text) as ApiErrorBody) : null;
  } catch {
    body = null;
  }
  return new ApiError(
    res.status,
    body?.error?.code ?? "HTTP_ERROR",
    body?.error?.message ?? `Request failed with status ${res.status}`,
    body?.error?.details,
  );
}

/* ------------------------------------------------------------------ *
 * Query types
 * ------------------------------------------------------------------ */

export interface ListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
  q?: string;
}

/* ------------------------------------------------------------------ *
 * The surface
 * ------------------------------------------------------------------ */

export const api = {
  health: () => request<Health>("GET", "/health", { auth: false }),

  auth: {
    login: (email: string, password: string) =>
      request<LoginResult>("POST", "/api/v1/auth/login", {
        auth: false,
        body: { email, password },
      }),

    register: (body: { email: string; password: string; fullName: string; phone?: string }) =>
      request<RegisterResult>("POST", "/api/v1/auth/register", { auth: false, body }),

    refresh: (refreshToken: string) =>
      request<{ session: Session }>("POST", "/api/v1/auth/refresh", {
        auth: false,
        body: { refreshToken },
      }),

    logout: () => request<void>("POST", "/api/v1/auth/logout"),

    me: () => request<Me>("GET", "/api/v1/auth/me"),
  },

  services: {
    list: (query: ListQuery & { category?: ServiceCategory; includeInactive?: boolean } = {}) =>
      request<Paginated<Service>>("GET", "/api/v1/services", { auth: false, query }),

    search: (q: string, limit = 20) =>
      request<Service[]>("GET", "/api/v1/services/search", { auth: false, query: { q, limit } }),

    get: (id: string) => request<Service>("GET", `/api/v1/services/${id}`, { auth: false }),
  },

  employees: {
    list: (query: ListQuery & { includeInactive?: boolean; serviceId?: string } = {}) =>
      request<Paginated<Employee>>("GET", "/api/v1/employees", { auth: false, query }),

    get: (id: string) => request<Employee>("GET", `/api/v1/employees/${id}`, { auth: false }),
  },

  availability: (query: {
    serviceId: string;
    date: string;
    employeeId?: string;
    intervalMinutes?: number;
  }) => request<Availability>("GET", "/api/v1/availability", { auth: false, query }),

  bookings: {
    create: (body: CreateBookingInput) =>
      request<Booking>("POST", "/api/v1/bookings", { body }),

    list: (query: ListQuery & {
      status?: BookingStatus;
      employeeId?: string;
      clientId?: string;
      from?: string;
      to?: string;
    } = {}) => request<Paginated<Booking>>("GET", "/api/v1/bookings", { query }),

    get: (id: string) => request<Booking>("GET", `/api/v1/bookings/${id}`),

    cancel: (id: string, body: { reason?: string; force?: boolean } = {}) =>
      request<{ booking: Booking }>("POST", `/api/v1/bookings/${id}/cancel`, { body }),

    reschedule: (id: string, startTime: string) =>
      request<Booking>("POST", `/api/v1/bookings/${id}/reschedule`, { body: { startTime } }),

    qr: (id: string) => request<QrState>("GET", `/api/v1/bookings/${id}/qr`),

    setStatus: (id: string, status: BookingStatus) =>
      request<Booking>("PATCH", `/api/v1/bookings/${id}/status`, { body: { status } }),

    mine: (query: ListQuery & { status?: BookingStatus; upcoming?: boolean } = {}) =>
      request<Paginated<Booking>>("GET", "/api/v1/me/bookings", { query }),
  },

  qr: {
    branch: () => request<BranchQr>("GET", "/api/v1/qr/branch"),

    checkIn: (pass: string) =>
      request<CheckInResult>("POST", "/api/v1/qr/check-in", { body: { pass } }),
  },

  promos: {
    /** Always 200 — an unknown code is a normal answer, not an error. */
    validate: (body: {
      code: string;
      serviceIds?: string[];
      subtotalCents?: number;
      guestPhone?: string;
    }) => request<PromoValidation>("POST", "/api/v1/promos/validate", { body }),

    list: (query: ListQuery & { activeOnly?: boolean } = {}) =>
      request<Paginated<Promo>>("GET", "/api/v1/promos", { query }),

    create: (body: {
      code: string;
      type: PromoType;
      value: number;
      startsAt?: string;
      endsAt?: string;
      maxRedemptions?: number;
      perClientLimit?: number;
      minSpendCents?: number;
      applicableServiceIds?: string[];
      isActive?: boolean;
    }) => request<Promo>("POST", "/api/v1/promos", { body }),

    update: (id: string, body: Partial<Omit<Promo, "id" | "createdAt" | "updatedAt">>) =>
      request<Promo>("PATCH", `/api/v1/promos/${id}`, { body }),

    deactivate: (id: string) => request<Promo>("DELETE", `/api/v1/promos/${id}`),
  },

  admin: {
    dashboard: (from: string, to: string) =>
      request<Dashboard>("GET", "/api/v1/admin/dashboard", { query: { from, to } }),

    clients: (query: ListQuery & { includeInactive?: boolean } = {}) =>
      request<Paginated<ClientRecord>>("GET", "/api/v1/admin/clients", { query }),

    client: (id: string) => request<ClientDetail>("GET", `/api/v1/admin/clients/${id}`),

    updateClient: (
      id: string,
      body: {
        fullName?: string;
        phone?: string | null;
        email?: string | null;
        notes?: string | null;
        isActive?: boolean;
      },
    ) => request<ClientDetail>("PATCH", `/api/v1/admin/clients/${id}`, { body }),

    deactivateClient: (id: string) => request<ClientDetail>("DELETE", `/api/v1/admin/clients/${id}`),

    bookings: (query: ListQuery & {
      status?: BookingStatus;
      employeeId?: string;
      from?: string;
      to?: string;
    } = {}) => request<Paginated<Booking>>("GET", "/api/v1/admin/bookings", { query }),

    employees: (query: ListQuery & { includeInactive?: boolean } = {}) =>
      request<Paginated<Employee>>("GET", "/api/v1/admin/employees", { query }),

    promos: (query: ListQuery & { activeOnly?: boolean } = {}) =>
      request<Paginated<Promo>>("GET", "/api/v1/admin/promos", { query }),

    auditLogs: (query: ListQuery & { action?: string; entity?: string } = {}) =>
      request<Paginated<AuditLog>>("GET", "/api/v1/admin/audit-logs", { query }),

    createStaff: (body: {
      email: string;
      password: string;
      fullName: string;
      role: "STAFF" | "ADMIN";
    }) => request<AuthUser>("POST", "/api/v1/admin/users/staff", { body }),

    /**
     * The CSV endpoint is a plain `text/csv` response behind the same bearer
     * token, so a bare `<a href>` cannot reach it. Fetch it with the header and
     * hand the browser a blob instead.
     */
    async downloadClientsCsv(): Promise<void> {
      const csv = await requestText("/api/v1/admin/clients/export.csv");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `beauty-alley-clients-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  },
};

/* ------------------------------------------------------------------ *
 * Presentational helpers shared by the pages
 * ------------------------------------------------------------------ */

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  IN_SERVICE: "In service",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No show",
};

export type StatusTone = "default" | "secondary" | "outline" | "success" | "warning" | "destructive";

export const STATUS_TONE: Record<BookingStatus, StatusTone> = {
  PENDING: "secondary",
  CONFIRMED: "outline",
  CHECKED_IN: "warning",
  IN_SERVICE: "default",
  COMPLETED: "success",
  CANCELLED: "secondary",
  NO_SHOW: "destructive",
};

/** The transitions the database will accept, mirroring migration 11's trigger. */
export const NEXT_STATUS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["IN_SERVICE", "COMPLETED", "NO_SHOW"],
  IN_SERVICE: ["COMPLETED", "NO_SHOW"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};
