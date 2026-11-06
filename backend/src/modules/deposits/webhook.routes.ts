import { Router } from "express";
import type { Request, Response } from "express";

import { asyncHandler } from "../../lib/asyncHandler";
import { depositsService } from "./deposits.service";

export const webhooksRouter = Router();

/**
 * HitPay's `payment_request.completed` webhook.
 *
 * Register this in the HitPay dashboard at Developers → Webhook Endpoints:
 *   https://beautyalleyibms.vercel.app/api/v1/webhooks/hitpay
 *
 * The signature is HMAC-SHA256 over the RAW body using the dashboard's salt.
 * A missing or bad signature is a 401; the redirect_url is never trusted.
 */
webhooksRouter.post(
  "/hitpay",
  asyncHandler(async (req: Request, res: Response) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody?.toString("utf8") ?? "";
    await depositsService.handlePaymentWebhook(raw, req.header("hitpay-signature") ?? undefined);
    res.status(200).json({ data: { received: true } });
  })
);
