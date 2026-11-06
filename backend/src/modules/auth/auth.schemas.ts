import { z } from "zod";

/**
 * Shared password rule. Length is the only thing that materially helps; the
 * character-class rules people usually add push users towards `Passw0rd!`
 * without adding real entropy.
 */
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters"); // bcrypt's hard limit

/**
 * A client account, created at the desk.
 *
 * This is the only account a concierge may make, and it is deliberately a
 * separate schema from the staff one: there is no role field to get wrong,
 * and the role it creates is CLIENT, full stop.
 */
export const createClientSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password,
  fullName: z.string().trim().min(1, "Name is required").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()\-]{7,20}$/, "Enter a valid phone number")
    .optional(),
});

/** A new password for an existing client login. Same rule as everywhere else. */
export const resetClientPasswordSchema = z.object({ password });

/**
 * Changing your own password.
 *
 * The current password is required even though the caller already holds a
 * valid session. A session can be left open on a shared front-desk terminal;
 * requiring the old password means the person at the keyboard is the person
 * who knows it, not merely the person who found the tab.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "The new password must be different from the current one",
    path: ["newPassword"],
  });

/**
 * An administrator setting a password for any account.
 *
 * Addressed by email because that is what the owner has in front of them in
 * the demo accounts file and in the team list. The role check is on the route
 * (ADMIN); the service additionally refuses nothing by role, because the owner
 * is allowed to reset any account, including another administrator's.
 */
export const adminResetPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  newPassword: password,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, "A refresh token is required"),
});

/**
 * Roles an owner may hand out.
 *
 * CLIENT and GUEST are absent on purpose: a client account comes from
 * /auth/register, and GUEST is not an account at all but what the actor
 * resolver returns for nobody. Accepting either here would let an admin mint
 * an account whose role the rest of the system never expects to see in
 * `profiles`.
 *
 * The legacy label 'STAFF' is deliberately NOT accepted. It was retired in
 * migration 24, and `role_from_app_metadata` keeps mapping it for the auth
 * users that already carry it - but a *new* account should not be created
 * under a name the schema no longer has.
 */
export const createStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password,
  fullName: z.string().trim().min(1).max(120),
  role: z.enum(["EMPLOYEE", "CONCIERGE", "ADMIN"]),
  /** Optionally create the linked employees row in the same call. */
  title: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(2000).optional(),
  /**
   * What the roster row is qualified to do.
   *
   * Without this the console could only ever create stylists qualified for
   * nothing: `createStaff` passed an empty array, so the new person appeared on
   * the roster marked "cannot be booked for anything yet" and was absent from
   * every service-filtered list and from the booking grid - which reads as the
   * creation having failed. `create_employee` already writes the
   * qualifications in the same statement as the row.
   *
   * Ignored for CONCIERGE and ADMIN, who get no roster row at all.
   */
  serviceIds: z.array(z.guid()).max(100).default([]),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type ResetClientPasswordInput = z.infer<typeof resetClientPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
