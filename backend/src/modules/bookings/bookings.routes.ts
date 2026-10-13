import { Router } from "express";
import type { Request, Response } from "express";
import { bookingsController } from "./bookings.controller";
import {
  cancelBookingSchema,
  createBookingSchema,
  createNoteSchema,
  idParamSchema,
  listBookingsQuerySchema,
  myBookingsQuerySchema,
  noteParamSchema,
  rescheduleBookingSchema,
  setRoomSchema,
  updateStatusSchema,
} from "./bookings.schemas";
import { authenticate, optionalAuthenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";
import { AppError, CODES } from "../../lib/errors";
import { loyaltyService } from "../loyalty/loyalty.service";
import type { Actor } from "../../types/actor";

export const bookingsRouter = Router();
export const meRouter = Router();

// --- client's own bookings -------------------------------------------------
meRouter.get(
  "/bookings",
  authenticate,
  validate({ query: myBookingsQuerySchema }),
  asyncHandler(bookingsController.mine)
);

/**
 * The client's own membership standing.
 *
 * Scoped to `actor.clientId`, so it can only ever describe the caller - there
 * is no id in the path to tamper with. A signed-in account with no client row
 * gets a not-found rather than a fabricated zero, because "you have 0 visits"
 * and "we do not know you" are different answers and only one of them is true.
 */
meRouter.get(
  "/loyalty",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const actor = req.actor as Actor;
    if (!actor.clientId) {
      throw AppError.notFound(CODES.CLIENT_NOT_FOUND, "This account has no client record");
    }
    res.status(200).json({ data: await loyaltyService.forClient(actor.clientId) });
  })
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

// --- aftercare notes -------------------------------------------------------
// Optional auth on the read: the guest holding the booking uuid is exactly who
// the note was written for. Staff see the internal ones as well.
bookingsRouter.get(
  "/:id/notes",
  optionalAuthenticate,
  validate({ params: idParamSchema }),
  asyncHandler(bookingsController.notes)
);

// Only the therapist and the desk write notes.
bookingsRouter.post(
  "/:id/notes",
  authenticate,
  requireRole("STAFF", "ADMIN"),
  validate({ params: idParamSchema, body: createNoteSchema }),
  asyncHandler(bookingsController.addNote)
);

bookingsRouter.delete(
  "/:id/notes/:noteId",
  authenticate,
  requireRole("STAFF", "ADMIN"),
  validate({ params: noteParamSchema }),
  asyncHandler(bookingsController.deleteNote)
);

// --- room override ---------------------------------------------------------
// STAFF, not ADMIN: moving a treatment to another room is a desk decision made
// while the client is standing there.
bookingsRouter.patch(
  "/:id/room",
  authenticate,
  requireRole("STAFF", "ADMIN"),
  validate({ params: idParamSchema, body: setRoomSchema }),
  asyncHandler(bookingsController.setRoom)
);
