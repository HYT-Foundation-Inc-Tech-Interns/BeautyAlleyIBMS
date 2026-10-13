import { z } from "zod";

export const promoteClientSchema = z.object({
  /**
   * Defaults to 3, the agreed member rate. Kept settable so a goodwill
   * upgrade (a long-standing client, a complaint resolved) does not need a
   * code change - but bounded, because a 90% rate typed by accident is a
   * pricing bug that would silently apply to every future booking.
   */
  discountPercent: z.coerce.number().int().min(1).max(50).default(3),
});

export const listLoyaltyQuerySchema = z.object({
  /** Only clients who have earned the promotion and not yet received it. */
  eligibleOnly: z.coerce.boolean().default(false),
  memberOnly: z.coerce.boolean().default(false),
  q: z.string().trim().max(80).optional(),
});

export const clientIdParamSchema = z.object({ id: z.string().uuid("Not a valid client id") });

export type PromoteClientInput = z.infer<typeof promoteClientSchema>;
export type ListLoyaltyQuery = z.infer<typeof listLoyaltyQuerySchema>;
