import { Router } from "express";
import type { Request, Response } from "express";

import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";
import { depositsService, testCheckoutSchema } from "./deposits.service";

export const depositsRouter = Router();

/**
 * Open a HitPay checkout for a test amount.
 *
 * ADMIN only: it spends the salon's HitPay account, even in sandbox mode. It is
 * not tied to a booking, so it cannot be used to mark a real deposit paid.
 */
depositsRouter.post(
  "/test-checkout",
  authenticate,
  requireRole("ADMIN"),
  validate({ body: testCheckoutSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await depositsService.testCheckout(req.body, req.actor!);
    res.status(201).json({ data: result });
  })
);
