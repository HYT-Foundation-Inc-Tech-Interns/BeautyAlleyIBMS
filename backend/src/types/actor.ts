export type Role = "GUEST" | "CLIENT" | "STAFF" | "ADMIN";

/**
 * The authenticated caller, resolved once per request.
 *
 * `role` comes from `public.profiles`, never from the token payload. A JWT can
 * carry a stale or forged role claim; the profile row is the authority, and it
 * is the same row the database's own policies consult.
 */
export interface Actor {
  id: string;
  email: string | null;
  role: Role;
  fullName: string | null;
  /** Set when this account is linked to a clients row. */
  clientId: string | null;
  /** Set when this account is linked to an employees row. */
  employeeId: string | null;
  isActive: boolean;
  accessToken: string;
}
