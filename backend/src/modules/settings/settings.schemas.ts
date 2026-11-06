import { z } from "zod";

/**
 * The provider ids are a closed set on purpose.
 *
 * The UI may show them in any order and toggle them, but it cannot invent a
 * provider: a typo like "g-cash" would silently disappear from every report
 * that groups by provider. Adding a provider is a code change plus a seed
 * update, which is the correct amount of friction for something that will
 * eventually be wired to a payment processor.
 */
export const paymentProviderId = z.enum(["cash", "gcash", "maya", "card", "bank_transfer"]);

export const updatePaymentProvidersSchema = z
  .object({
    default: paymentProviderId,
    options: z
      .array(
        z.object({
          id: paymentProviderId,
          enabled: z.boolean(),
        })
      )
      .min(1, "At least one provider is required")
      .max(10),
  })
  .refine((v) => new Set(v.options.map((o) => o.id)).size === v.options.length, {
    message: "Each provider may appear only once",
    path: ["options"],
  })
  .refine((v) => v.options.some((o) => o.id === v.default && o.enabled), {
    message: "The default provider must be one of the enabled options",
    path: ["default"],
  });

export type UpdatePaymentProvidersInput = z.infer<typeof updatePaymentProvidersSchema>;

/**
 * The two booking policies the owner can change.
 *
 * The bounds are deliberately generous but finite: a cancellation window of
 * 0 is "no notice needed", 72 hours is three days. An arrival window of 0
 * means the pass opens at the appointment time; 240 minutes is four hours.
 * A negative or absurd number is a typo, not a policy.
 */
export const updateBookingRulesSchema = z.object({
  cancellationWindowHours: z.number().int().min(0).max(72),
  arrivalWindowMinutes: z.number().int().min(0).max(240),
});

export type UpdateBookingRulesInput = z.infer<typeof updateBookingRulesSchema>;

/**
 * The deposit policy.
 *
 * Enabled is off by default in the database, so this schema is only ever
 * reached after the owner has made a decision. The bounds match the gateway
 * adapter: one peso to ten thousand pesos.
 *
 * onCancel is the money rule and belongs to the owner, not to the code:
 *   refund          - a cancellation always returns a held deposit
 *   forfeit         - a cancellation always keeps it
 *   forfeit_if_late - keeps it only inside the cancellation window
 * A no-show always forfeits, whatever this says.
 */
export const updateDepositPolicySchema = z.object({
  enabled: z.boolean(),
  amountCents: z.number().int().min(100).max(1_000_000),
  onCancel: z.enum(["refund", "forfeit", "forfeit_if_late"]),
});

export type UpdateDepositPolicyInput = z.infer<typeof updateDepositPolicySchema>;
