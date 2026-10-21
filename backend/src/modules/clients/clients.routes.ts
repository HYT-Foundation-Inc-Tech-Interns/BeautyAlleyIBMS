import { Router } from "express";
import { clientsController } from "./clients.controller";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { asyncHandler } from "../../lib/asyncHandler";

export const clientsRouter = Router();

/**
 * The desk's client lookup.
 *
 * DESK, not ADMIN: reception is who attaches a booking to an existing client,
 * and this endpoint returns a name, a phone and an email — not the client
 * record. The full record stays behind `/admin/clients`.
 */
clientsRouter.get(
  "/search",
  authenticate,
  requireRole("ADMIN", "CONCIERGE"),
  asyncHandler(clientsController.search)
);
