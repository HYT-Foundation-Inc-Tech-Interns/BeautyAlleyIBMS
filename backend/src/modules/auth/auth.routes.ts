import { Router } from "express";
import { authController } from "./auth.controller";
import { createClientSchema, createStaffSchema, loginSchema, refreshSchema } from "./auth.schemas";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";
import { loginLimiter } from "../../middleware/rateLimit";

export const authRouter = Router();

/*
 * There is no public sign-up.
 *
 * POST /auth/register used to exist and minted CLIENT accounts from the open
 * internet, which meant anyone could create an identity inside the salon
 * system - and, because Supabase sends a confirmation mail for it, anyone
 * could also generate mail from the salon domain. Accounts are now created by
 * an administrator through the route at the bottom of this file, with
 * email_confirm already set, so no confirmation mail is ever generated and
 * no self-service door exists to find.
 */

// The limiter sits in front of validation so a flood is rejected before it
// costs a zod parse.
authRouter.post(
  "/login",
  loginLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login)
);

authRouter.post("/refresh", validate({ body: refreshSchema }), asyncHandler(authController.refresh));

authRouter.post("/logout", authenticate, asyncHandler(authController.logout));
authRouter.get("/me", authenticate, asyncHandler(authController.me));

export const adminAuthRouter = Router();

/*
 * The split the salon actually runs on: an administrator makes every account,
 * and the concierge makes exactly one kind - a client. The desk meets people
 * who want a login for their history, and sending them to an administrator
 * for a form the desk already has on screen is friction with no security
 * value: a CLIENT account can read its own bookings and nothing else.
 */
adminAuthRouter.post(
  "/users/client",
  authenticate,
  requireRole("ADMIN", "CONCIERGE"),
  validate({ body: createClientSchema }),
  asyncHandler(authController.createClient)
);

adminAuthRouter.post(
  "/users/staff",
  authenticate,
  requireRole("ADMIN"),
  validate({ body: createStaffSchema }),
  asyncHandler(authController.createStaff)
);
