"use client";

/**
 * Who is signed in, and what they may do.
 *
 * This replaces the old `role.tsx`, which was a `useState` toggle in the
 * sidebar — three hard-coded personas you could switch between by clicking.
 * It looked like access control and was the opposite of it: every role was
 * reachable by everyone, the "signed-in" identity was a constant string, and
 * nothing was ever verified. The permission map below is the same idea, but
 * the role now comes from a signed token the server issued.
 *
 * ## Why the role is not read from the token
 *
 * It could be decoded from the JWT, but the role that governs access lives in
 * `profiles.role`, and a JWT is a snapshot — if an account is demoted, the
 * token keeps asserting the old role until it expires. So the role is taken
 * from `GET /auth/me`, which reads the live row. The token is treated purely
 * as proof of identity.
 *
 * ## Why this is not the security boundary
 *
 * Everything here is a *courtesy*: it stops a client seeing a nav item that
 * would 403. The real boundary is the API, which gates every route with
 * `requireRole` and enforces RLS underneath that. Hiding a button is not
 * security, and nothing below is written as though it were.
 */

import * as React from "react";

import { api, ApiError, bindTokens } from "@/lib/api";
import type { Me, Role, Session } from "@/lib/api-types";
import { clearSession, loadSession, saveSession } from "./session";

/* ------------------------------------------------------------------ *
 * The permission map
 * ------------------------------------------------------------------ */

export type Area =
  | "overview"
  | "bookings"
  | "clients"
  | "promos"
  | "employees"
  | "check-in"
  | "board"
  | "my-bookings";

/**
 * What each role may open. This mirrors the backend's `requireRole` calls
 * exactly — a mismatch in either direction is a bug, and the smoke test walks
 * every route as every role to prove the API agrees.
 *
 * Note the shape of the three roles:
 *
 *   ADMIN  runs the business — the full record of bookings, clients, promos
 *          and employees, plus the monitoring board.
 *   STAFF  works the floor — the run sheet and the door. No money, no
 *          customer records, no employee management.
 *   CLIENT is a customer — their own bookings and nothing else.
 *
 * The board is ADMIN-only because `/admin/dashboard` is `requireRole("ADMIN")`
 * — a tile showing revenue has no honest staff-facing version, so staff get the
 * run sheet on Overview instead of a filtered imitation of this page.
 */
export const SCOPE: Record<Role, Area[]> = {
  ADMIN: ["overview", "bookings", "clients", "promos", "employees", "check-in", "board"],
  STAFF: ["overview", "bookings", "check-in"],
  CLIENT: ["my-bookings"],
};

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrator",
  STAFF: "Stylist",
  CLIENT: "Client",
};

export const ROLE_BLURB: Record<Role, string> = {
  ADMIN: "Full access — bookings, clients, promos and team",
  STAFF: "Your chair and the door — run sheet and check-in",
  CLIENT: "Your appointments and arrival passes",
};

/** Where each role lands after signing in. */
export function homeFor(role: Role): string {
  return role === "CLIENT" ? "/app/my-bookings" : "/app";
}

/* ------------------------------------------------------------------ *
 * Context
 * ------------------------------------------------------------------ */

export type AuthStatus = "loading" | "anonymous" | "authenticated";

export interface AuthValue {
  status: AuthStatus;
  /** The live profile, including `clientId` / `employeeId` when they exist. */
  me: Me | null;
  role: Role | null;
  session: Session | null;
  isAdmin: boolean;
  isStaff: boolean;
  can: (area: Area) => boolean;
  login: (email: string, password: string) => Promise<Me>;
  register: (input: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
  }) => Promise<{ requiresEmailConfirmation: boolean }>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = React.createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthStatus>("loading");
  const [me, setMe] = React.useState<Me | null>(null);
  const [session, setSession] = React.useState<Session | null>(null);

  /**
   * The transport layer reads tokens through a ref rather than from state, so
   * a request issued in the same tick as a refresh still sees the new token.
   */
  const sessionRef = React.useRef<Session | null>(null);

  const apply = React.useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
    if (next) saveSession(next);
    else clearSession();
  }, []);

  /**
   * Exchange the refresh token for a new session.
   *
   * Called by the transport on a 401, so it must never itself throw — a failed
   * refresh is a normal outcome that means "signed out", not an error to
   * propagate into whatever request happened to be in flight.
   */
  const doRefresh = React.useCallback(async (): Promise<Session | null> => {
    const current = sessionRef.current;
    if (!current?.refreshToken) return null;
    try {
      const { session: fresh } = await api.auth.refresh(current.refreshToken);
      apply(fresh);
      return fresh;
    } catch {
      apply(null);
      setMe(null);
      setStatus("anonymous");
      return null;
    }
  }, [apply]);

  // Declared before the boot effect so the port is bound by the time the first
  // request goes out. Effects run in declaration order.
  React.useEffect(() => {
    bindTokens({
      get: () => sessionRef.current,
      refresh: doRefresh,
    });
  }, [doRefresh]);

  /**
   * Restore the session on mount.
   *
   * A stored session is only a *claim* of being signed in — it is a token in
   * localStorage that may be expired or revoked. So it is never trusted on its
   * own: it is presented to `/auth/me`, and only a real answer promotes the
   * app to `authenticated`. The transport's silent refresh handles the
   * expired-but-refreshable case underneath.
   *
   * ## Why there is no "already booted" guard here
   *
   * There was one, and it hung the whole app in development. React 18's
   * StrictMode deliberately mounts, unmounts and remounts every component in
   * dev, to surface effects that are not safe to run twice. The sequence was:
   *
   *   1. mount   -> guard set, `me()` fired, cleanup captured
   *   2. unmount -> cleanup ran, `cancelled = true`
   *   3. remount -> guard already set, so it returned early and fired *nothing*
   *   4. the original response arrived, saw `cancelled`, and was dropped
   *
   * Nothing was left to write `authenticated`, so the app sat on "Checking your
   * session…" forever — in dev only, which is exactly where a guard like that
   * feels harmless. The effect is idempotent (a read, plus a state write), so
   * the correct answer is to let it run again rather than to suppress it: the
   * second run's response is the one that lands.
   */
  React.useEffect(() => {
    const stored = loadSession();
    if (!stored) {
      setStatus("anonymous");
      return;
    }

    apply(stored);

    let cancelled = false;
    (async () => {
      try {
        const profile = await api.auth.me();
        if (cancelled) return;
        setMe(profile);
        setStatus("authenticated");
      } catch {
        if (cancelled) return;
        apply(null);
        setMe(null);
        setStatus("anonymous");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apply]);

  const login = React.useCallback(
    async (email: string, password: string) => {
      const result = await api.auth.login(email, password);
      apply(result.session);
      // The login payload carries a name but not the row ids; `/me` has both.
      const profile = await api.auth.me();
      setMe(profile);
      setStatus("authenticated");
      return profile;
    },
    [apply],
  );

  const register = React.useCallback(
    async (input: { email: string; password: string; fullName: string; phone?: string }) => {
      const result = await api.auth.register(input);
      if (result.session) {
        apply(result.session);
        try {
          setMe(await api.auth.me());
          setStatus("authenticated");
        } catch {
          // Signed up but the profile read failed — treat as anonymous rather
          // than claiming a session we cannot describe.
          apply(null);
          setStatus("anonymous");
        }
      }
      return { requiresEmailConfirmation: result.requiresEmailConfirmation };
    },
    [apply],
  );

  const logout = React.useCallback(async () => {
    try {
      await api.auth.logout();
    } catch (err) {
      // Revoking server-side is best-effort. If it fails the local session is
      // still dropped — the token expires on its own.
      if (!(err instanceof ApiError)) throw err;
    }
    apply(null);
    setMe(null);
    setStatus("anonymous");
  }, [apply]);

  const reload = React.useCallback(async () => {
    try {
      setMe(await api.auth.me());
    } catch {
      apply(null);
      setMe(null);
      setStatus("anonymous");
    }
  }, [apply]);

  const value = React.useMemo<AuthValue>(() => {
    const role = me?.role ?? null;
    return {
      status,
      me,
      role,
      session,
      isAdmin: role === "ADMIN",
      isStaff: role === "STAFF" || role === "ADMIN",
      can: (area: Area) => (role ? SCOPE[role].includes(area) : false),
      login,
      register,
      logout,
      reload,
    };
  }, [status, me, session, login, register, logout, reload]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an AuthProvider");
  return ctx;
}
