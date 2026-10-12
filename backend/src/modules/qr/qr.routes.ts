import { Router } from "express";
import type { Request, Response } from "express";
import { checkInSchema, qrService } from "./qr.service";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";
import type { Actor } from "../../types/actor";

export const qrRouter = Router();

qrRouter.get("/branch", authenticate, requireRole("STAFF", "ADMIN"), (_req: Request, res: Response) => {
  res.status(200).json({ data: qrService.branch() });
});

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
