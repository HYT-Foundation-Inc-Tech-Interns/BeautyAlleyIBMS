import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { sendMail, smtpConfigured } from "../../lib/mailer";
import type { Actor } from "../../types/actor";
import { settingsRepository } from "./settings.repository";
import { bookingDepositsRepository } from "../deposits/deposits.repository";
import type { ReminderStats } from "./settings.repository";
import type {
  UpdateBookingRulesInput,
  UpdateDepositPolicyInput,
  UpdatePaymentProvidersInput,
} from "./settings.schemas";

/**
 * Payment providers.
 *
 * The salon asked for every provider to be available as an option, without
 * committing to a processor yet. So this is a *configuration list*, not an
 * integration: `enabled` means "show this at the point of sale", and the
 * actual charge still happens on the terminal.
 *
 * The canonical list lives here rather than in the database, because the
 * labels and the allowed ids are code. The database stores only the owner's
 * decisions (which are enabled, which is the default), and the read path
 * merges the two. That way adding a provider in a future release makes it
 * appear as a disabled option instead of silently vanishing from the screen.
 */

const KEY = "payments.providers";

export const PAYMENT_PROVIDERS = [
  { id: "cash", label: "Cash" },
  { id: "gcash", label: "GCash" },
  { id: "maya", label: "Maya" },
  { id: "card", label: "Card" },
  { id: "bank_transfer", label: "Bank transfer" },
] as const;

export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number]["id"];

export interface PaymentProviderOption {
  id: PaymentProviderId;
  label: string;
  enabled: boolean;
}

export interface PaymentProvidersSetting {
  default: PaymentProviderId;
  options: PaymentProviderOption[];
  updatedAt: string | null;
  updatedBy: string | null;
}

// A type alias, not an interface: TypeScript gives aliases an implicit index
// signature, which is what lets this be stored as `Json` without a cast.
type StoredShape = {
  default?: string;
  options?: { id?: string; enabled?: boolean }[];
};

function canonical(): PaymentProviderOption[] {
  return PAYMENT_PROVIDERS.map((p) => ({ ...p, enabled: true }));
}

/**
 * Merge stored decisions with the canonical list.
 *
 * - a stored provider that no longer exists in code is dropped
 * - a canonical provider missing from storage appears enabled (new feature)
 * - labels always come from code, never from the database
 */
function merge(stored: StoredShape | null): PaymentProviderOption[] {
  if (!stored?.options?.length) return canonical();

  const byId = new Map(stored.options.map((o) => [o.id, o.enabled === true]));
  return PAYMENT_PROVIDERS.map((p) => ({
    ...p,
    enabled: byId.has(p.id) ? byId.get(p.id)! : true,
  }));
}

function defaultId(stored: StoredShape | null, options: PaymentProviderOption[]): PaymentProviderId {
  const candidate = stored?.default;
  const match = options.find((o) => o.id === candidate && o.enabled);
  return (match?.id ?? options.find((o) => o.enabled)?.id ?? "cash") as PaymentProviderId;
}

/* ------------------------------------------------------------------ *
 * Booking rules
 * ------------------------------------------------------------------ */

const BOOKING_KEY = "booking.rules";

type StoredBookingRules = {
  cancellationWindowHours?: number;
  arrivalWindowMinutes?: number;
};

export interface BookingRules {
  cancellationWindowHours: number;
  arrivalWindowMinutes: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * A stored number, or the deployment fallback.
 *
 * The fallback is what makes this migration safe: a database that has not been
 * migrated, or a row someone deleted, still behaves exactly as it did when the
 * values came from env.
 */
function bookingNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export interface ReminderStatus extends ReminderStats {
  configured: boolean;
}

export const settingsService = {
  async getPaymentProviders(): Promise<PaymentProvidersSetting> {
    const row = await settingsRepository.get<StoredShape>(KEY);
    const options = merge(row?.value ?? null);
    return {
      default: defaultId(row?.value ?? null, options),
      options,
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by ?? null,
    };
  },

  async updatePaymentProviders(
    input: UpdatePaymentProvidersInput,
    actor: Actor
  ): Promise<PaymentProvidersSetting> {
    // Keep the canonical order and labels; store only the decisions.
    const decisions = new Map(input.options.map((o) => [o.id, o.enabled]));
    const options = PAYMENT_PROVIDERS.map((p) => ({
      ...p,
      enabled: decisions.get(p.id) ?? false,
    }));

    const stored: StoredShape = {
      default: input.default,
      options: options.map((o) => ({ id: o.id, enabled: o.enabled })),
    };

    const row = await settingsRepository.put(KEY, stored, actor.id);

    logger.info("settings.payments_updated", {
      by: actor.id,
      default: input.default,
      enabled: options.filter((o) => o.enabled).map((o) => o.id),
    });

    return {
      default: input.default,
      options,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  },

  async getBookingRules(): Promise<BookingRules> {
    const row = await settingsRepository.get<StoredBookingRules>(BOOKING_KEY);
    return {
      cancellationWindowHours: bookingNumber(
        row?.value?.cancellationWindowHours,
        env.cancellationWindowHours
      ),
      arrivalWindowMinutes: bookingNumber(
        row?.value?.arrivalWindowMinutes,
        env.qrCheckinWindowMinutes
      ),
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by ?? null,
    };
  },

  async updateBookingRules(
    input: UpdateBookingRulesInput,
    actor: Actor
  ): Promise<BookingRules> {
    const stored: StoredBookingRules = {
      cancellationWindowHours: input.cancellationWindowHours,
      arrivalWindowMinutes: input.arrivalWindowMinutes,
    };
    const row = await settingsRepository.put(BOOKING_KEY, stored, actor.id);

    logger.info("settings.booking_rules_updated", {
      by: actor.id,
      cancellationWindowHours: input.cancellationWindowHours,
      arrivalWindowMinutes: input.arrivalWindowMinutes,
    });

    return {
      ...input,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  },

  async getReminderStatus(): Promise<ReminderStatus> {
    const stats = await settingsRepository.reminderStats();
    return { configured: smtpConfigured(), ...stats };
  },

  /** A single email to the signed-in owner, to prove the account works. */
  async sendTestReminder(actor: Actor): Promise<{ to: string }> {
    if (!smtpConfigured()) {
      throw AppError.badRequest("SMTP_NOT_CONFIGURED", "SMTP is not configured.");
    }
    const to = actor.email ?? env.smtpUser;
    if (!to) {
      throw AppError.badRequest("NO_RECIPIENT", "This account has no email address.");
    }
    try {
      await sendMail({
        to,
        subject: "Beauty Alley — reminder test",
        text: "This is a test from Settings → Reminders. Booking reminders can send from this account.",
      });
    } catch (err) {
      logger.warn("settings.reminder_test_failed", { by: actor.id, message: String(err) });
      throw AppError.badRequest("SMTP_ERROR", err instanceof Error ? err.message : "Could not send.");
    }
    logger.info("settings.reminder_test_sent", { by: actor.id, to });
    return { to };
  },

  /** The deposit obligation: whether it applies, how much, and what a cancel does. */
  async getDepositPolicy() {
    return bookingDepositsRepository.getPolicy();
  },

  async updateDepositPolicy(input: UpdateDepositPolicyInput, actor: Actor) {
    await bookingDepositsRepository.putPolicy(input, actor.id);
    logger.info("settings.deposit_policy_updated", {
      by: actor.id,
      enabled: input.enabled,
      amountCents: input.amountCents,
      onCancel: input.onCancel,
    });
    return bookingDepositsRepository.getPolicy();
  },
};
