import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import { asyncHandler } from "../../lib/asyncHandler";
import { validate } from "../../middleware/validate";
import { depositsService } from "./deposits.service";

const refParams = z.object({ ref: z.string().trim().min(1).max(100) });

export const depositTestRouter = Router();

/**
 * The built-in test gateway's public endpoints.
 *
 * These are deliberately unauthenticated: the "checkout" is a page the owner
 * opens in a new tab, exactly as a real hosted checkout would be. They can
 * only settle a row that the ADMIN-only test-checkout endpoint created, and
 * they represent no money.
 */
depositTestRouter.get(
  "/:ref",
  validate({ params: refParams }),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json({ data: await depositsService.getTestPayment(req.params.ref as string) });
  })
);

depositTestRouter.post(
  "/:ref/pay",
  validate({ params: refParams }),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json({ data: await depositsService.payTestPayment(req.params.ref as string) });
  })
);

depositTestRouter.post(
  "/:ref/cancel",
  validate({ params: refParams }),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json({ data: await depositsService.cancelTestPayment(req.params.ref as string) });
  })
);
