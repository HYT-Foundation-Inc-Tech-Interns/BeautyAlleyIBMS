import { Router } from "express";
import type { Request, Response } from "express";
import { checkInSchema, doorEntrySchema, qrService } from "./qr.service";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";
import { toDoorEntryUrl } from "../../lib/qr";
import { env } from "../../config/env";
import type { Actor } from "../../types/actor";

export const qrRouter = Router();

// --- public ----------------------------------------------------------------
/**
 * The walk-in door QR.
 *
 * GET, because the QR encodes a URL and a phone camera opens it directly -
 * requiring a POST would mean the page could not work before its JavaScript
 * boots. This is the endpoint that was missing: before it, the only routes
 * under /qr were STAFF/ADMIN, so a guest scanning the door sticker had
 * nowhere to land.
 *
 * No personal data leaves here unless the caller supplies a phone, and then
 * only a first name (see qrService.enter).
 */
qrRouter.get(
  "/enter",
  validate({ query: doorEntrySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await qrService.enter(req.query as never);
    res.status(200).json({ data: result });
  })
);

// --- staff -----------------------------------------------------------------
qrRouter.get("/branch", authenticate, requireRole("STAFF", "ADMIN"), (_req: Request, res: Response) => {
  res.status(200).json({ data: qrService.branch() });
});

/**
 * The door sticker itself, for the staff page that prints it. Signed with the
 * same secret as the booking passes, so a sticker can be regenerated at any
 * time and the URL it encodes cannot be guessed.
 */
qrRouter.get(
  "/door",
  authenticate,
  requireRole("STAFF", "ADMIN"),
  (_req: Request, res: Response) => {
    res.status(200).json({
      data: {
        label: "Beauty Alley - walk-in entry",
        branchId: env.branchId,
        url: toDoorEntryUrl(),
        // Unlike the desk QR this one DOES carry a signature, but it still
        // authorises nothing beyond the public menu.
        authorises: false,
        purpose: "Opens the walk-in registration screen.",
      },
    });
  }
);

qrRouter.post(
  "/check-in",
  authenticate,
  requireRole("STAFF", "ADMIN"),
  validate({ body: checkInSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await qrService.checkIn(req.body, req.actor as Actor);
    res.status(200).json({ data: result });
  })
);
