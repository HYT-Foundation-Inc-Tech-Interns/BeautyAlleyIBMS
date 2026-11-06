import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import type { Actor } from "../../types/actor";
import { testPaymentsRepository } from "./deposits.repository";

/**
 * Deposits: one adapter, two providers.
 *
 * - `mock` (default): the built-in test gateway. No merchant account, no
 *   verification, no external network call. A hosted page opens, the owner
 *   presses "Pay now (test)", and a **signed** webhook marks the request PAID.
 *   The signature path is the same one a real HitPay webhook will use.
 * - `sandbox` / `live`: HitPay's payment-request API.
 *
 * Nothing here is attached to a booking yet. This is the account/checkout
 * check; booking-level deposits are the next slice.
 */

export const testCheckoutSchema = z.object({
  amountCents: z.number().int().min(100).max(1_000_000),
});

export type TestCheckoutInput = z.infer<typeof testCheckoutSchema>;

export interface TestCheckout {
  mode: "mock" | "sandbox" | "live";
  amountCents: number;
  checkoutUrl: string;
  reference: string;
}

export interface TestPaymentDto {
  reference: string;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

function toDto(row: {
  reference: string;
  amount_cents: number;
  currency: string;
  status: string;
  created_at: string;
  paid_at: string | null;
}): TestPaymentDto {
  return {
    reference: row.reference,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

/** HMAC-SHA256 of the RAW body, exactly as HitPay signs its webhooks. */
function sign(raw: string): string {
  return createHmac("sha256", env.hitpaySalt).update(raw).digest("hex");
}

function signatureMatches(raw: string, signature: string | undefined): boolean {
  if (!signature || !env.hitpaySalt) return false;
  const expected = Buffer.from(sign(raw));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export const depositsService = {
  async testCheckout(input: TestCheckoutInput, actor: Actor): Promise<TestCheckout> {
    const reference = `DEP-TEST-${Date.now().toString(36).toUpperCase()}`;

    if (env.hitpayMode === "mock" || !env.hitpayApiKey) {
      await testPaymentsRepository.create(reference, input.amountCents);
      logger.info("deposits.test_checkout_mock", {
        by: actor.id,
        amount: input.amountCents,
        reference,
      });
      return {
        mode: "mock",
        amountCents: input.amountCents,
        checkoutUrl: `${env.appUrl}/deposit/mock?amount=${input.amountCents}&ref=${reference}`,
        reference,
      };
    }

    const base =
      env.hitpayMode === "sandbox"
        ? "https://api.sandbox.hit-pay.com"
        : "https://api.hit-pay.com";

    const response = await fetch(`${base}/v1/payment-requests`, {
      method: "POST",
      headers: {
        "X-BUSINESS-API-KEY": env.hitpayApiKey,
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        amount: Number((input.amountCents / 100).toFixed(2)),
        currency: "PHP",
        email: actor.email ?? "test@beautyalley.ph",
        name: "Beauty Alley deposit test",
        purpose: "Beauty Alley deposit (test)",
        reference_number: reference,
        redirect_url: `${env.appUrl}/app/settings?deposit=success`,
        send_email: false,
        send_sms: false,
        allow_repeated_payments: false,
        metadata: { purpose: "deposit_test", actor: actor.id },
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          id?: string;
          url?: string;
          error?: string | { code?: string; message?: string };
          message?: string;
          error_message?: string;
        }
      | null;

    if (!response.ok || !payload?.url) {
      const raw = payload?.error;
      const detail =
        (typeof raw === "string" ? raw : raw?.message) ??
        payload?.message ??
        payload?.error_message ??
        `HitPay returned ${response.status}`;
      logger.warn("deposits.test_checkout_failed", {
        by: actor.id,
        status: response.status,
        detail,
      });
      throw AppError.badRequest("HITPAY_ERROR", detail);
    }

    logger.info("deposits.test_checkout_created", {
      by: actor.id,
      amount: input.amountCents,
      reference: payload.id,
      mode: env.hitpayMode,
    });

    return {
      mode: env.hitpayMode,
      amountCents: input.amountCents,
      checkoutUrl: payload.url,
      reference: payload.id ?? reference,
    };
  },

  async getTestPayment(reference: string): Promise<TestPaymentDto> {
    const row = await testPaymentsRepository.get(reference);
    if (!row) throw AppError.notFound("TEST_PAYMENT_NOT_FOUND", "No such test payment");
    return toDto(row);
  },

  /**
   * Simulate a completed payment. It does NOT write PAID directly — it builds
   * the same signed webhook body HitPay will send and hands it to the shared
   * handler, so the signature check is exercised on every test payment.
   */
  async payTestPayment(reference: string): Promise<TestPaymentDto> {
    const row = await testPaymentsRepository.get(reference);
    if (!row) throw AppError.notFound("TEST_PAYMENT_NOT_FOUND", "No such test payment");
    if (row.status !== "PENDING") {
      throw AppError.conflict("TEST_PAYMENT_SETTLED", `This test payment is already ${row.status}.`);
    }

    const raw = JSON.stringify({
      id: row.reference,
      status: "completed",
      reference_number: row.reference,
      amount: (row.amount_cents / 100).toFixed(2),
      currency: row.currency,
    });
    await depositsService.handlePaymentWebhook(raw, sign(raw));

    const updated = await testPaymentsRepository.get(reference);
    if (!updated) throw AppError.notFound("TEST_PAYMENT_NOT_FOUND", "No such test payment");
    return toDto(updated);
  },

  async cancelTestPayment(reference: string): Promise<TestPaymentDto> {
    const row = await testPaymentsRepository.get(reference);
    if (!row) throw AppError.notFound("TEST_PAYMENT_NOT_FOUND", "No such test payment");
    if (row.status === "PENDING") await testPaymentsRepository.cancel(reference);
    const updated = await testPaymentsRepository.get(reference);
    if (!updated) throw AppError.notFound("TEST_PAYMENT_NOT_FOUND", "No such test payment");
    return toDto(updated);
  },

  /**
   * The real HitPay webhook lands here. The redirect URL is never trusted;
   * only a valid `Hitpay-Signature` over the raw body can mark anything paid.
   */
  async handlePaymentWebhook(raw: string, signature: string | undefined): Promise<void> {
    if (!signatureMatches(raw, signature)) {
      logger.warn("deposits.webhook_bad_signature");
      throw AppError.unauthorized("INVALID_SIGNATURE", "Invalid webhook signature");
    }

    type WebhookPayload = { reference_number?: string; status?: string };
    let payload: WebhookPayload | null = null;
    try {
      payload = JSON.parse(raw) as WebhookPayload;
    } catch {
      throw AppError.badRequest("INVALID_WEBHOOK", "Webhook body is not JSON");
    }
    if (payload?.status !== "completed" || !payload.reference_number) return;

    const updated = await testPaymentsRepository.markPaid(payload.reference_number);
    if (updated) {
      logger.info("deposits.payment_marked_paid", { reference: payload.reference_number });
    }
  },
};
