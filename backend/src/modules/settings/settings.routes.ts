import { Router } from "express";
import { settingsController } from "./settings.controller";
import { updateBookingRulesSchema, updatePaymentProvidersSchema } from "./settings.schemas";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";

export const settingsRouter = Router();

/**
 * The two numbers a client needs to read: how late they may cancel, and how
 * early their pass opens. No account, no secrets — the same policy the desk
 * applies, so the sentence on My bookings cannot drift from the server.
 */
settingsRouter.get("/public", asyncHandler(settingsController.getPublicPolicy));

/**
 * Owner-editable configuration.
 *
 * ADMIN only, both directions. A payment-provider list is not secret in the
 * way a key is, but it is business configuration: the desk should not be able
 * to turn off cash because a guest asked. The read is ADMIN too, because the
 * console is the only consumer and a public endpoint would invite scraping of
 * how the salon takes money.
 */
settingsRouter.get(
  "/payments",
  authenticate,
  requireRole("ADMIN"),
  asyncHandler(settingsController.getPayments)
);

settingsRouter.put(
  "/payments",
  authenticate,
  requireRole("ADMIN"),
  validate({ body: updatePaymentProvidersSchema }),
  asyncHandler(settingsController.updatePayments)
);

/*
 * Booking policy.
 *
 * These are the two rules that used to be environment variables. They are
 * read by the booking service on every cancellation and pass issuance, so a
 * change here takes effect on the next request — no redeploy.
 */
settingsRouter.get(
  "/booking",
  authenticate,
  requireRole("ADMIN"),
  asyncHandler(settingsController.getBooking)
);

settingsRouter.put(
  "/booking",
  authenticate,
  requireRole("ADMIN"),
  validate({ body: updateBookingRulesSchema }),
  asyncHandler(settingsController.updateBooking)
);

/*
 * Reminder status and a test email. ADMIN only: the status describes the
 * branch's whole queue, and the test spends the salon's mail account.
 */
settingsRouter.get(
  "/reminders",
  authenticate,
  requireRole("ADMIN"),
  asyncHandler(settingsController.getReminders)
);

settingsRouter.post(
  "/reminders/test",
  authenticate,
  requireRole("ADMIN"),
  asyncHandler(settingsController.testReminder)
);
