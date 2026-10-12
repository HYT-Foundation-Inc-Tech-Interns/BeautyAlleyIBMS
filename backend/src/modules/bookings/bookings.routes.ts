import { Router } from "express";
import { bookingsController } from "./bookings.controller";
import {
  cancelBookingSchema,
  createBookingSchema,
  idParamSchema,
  listBookingsQuerySchema,
  myBookingsQuerySchema,
  rescheduleBookingSchema,
  updateStatusSchema,
} from "./bookings.schemas";
import { authenticate, optionalAuthenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";

export const bookingsRouter = Router();
export const meRouter = Router();

// --- client's own bookings -------------------------------------------------
meRouter.get(
  "/bookings",
  authenticate,
  validate({ query: myBookingsQuerySchema }),
  asyncHandler(bookingsController.mine)
);

// --- create ----------------------------------------------------------------
// Optional auth: a signed-in client books against their own account, an
// anonymous visitor books as a guest. Both are legitimate.
bookingsRouter.post(
  "/",
  optionalAuthenticate,
  validate({ body: createBookingSchema }),
  asyncHandler(bookingsController.create)
);

// --- staff-only listing ----------------------------------------------------
bookingsRouter.get(
  "/",
  authenticate,
  requireRole("STAFF", "ADMIN"),
  validate({ query: listBookingsQuerySchema }),
  asyncHandler(bookingsController.list)
);

// --- single booking --------------------------------------------------------
// Optional auth so an owner and staff both get a real answer, while a stranger
// gets the same 404 either way.
bookingsRouter.get(
  "/:id",
  optionalAuthenticate,
  validate({ params: idParamSchema }),
  asyncHandler(bookingsController.getById)
);

bookingsRouter.post(
  "/:id/cancel",
  optionalAuthenticate,
  validate({ params: idParamSchema, body: cancelBookingSchema }),
  asyncHandler(bookingsController.cancel)
);

bookingsRouter.post(
  "/:id/reschedule",
  optionalAuthenticate,
  validate({ params: idParamSchema, body: rescheduleBookingSchema }),
  asyncHandler(bookingsController.reschedule)
);

bookingsRouter.get(
  "/:id/qr",
  optionalAuthenticate,
  validate({ params: idParamSchema }),
  asyncHandler(bookingsController.qr)
);

bookingsRouter.patch(
  "/:id/status",
  authenticate,
  requireRole("STAFF", "ADMIN"),
  validate({ params: idParamSchema, body: updateStatusSchema }),
  asyncHandler(bookingsController.updateStatus)
);
