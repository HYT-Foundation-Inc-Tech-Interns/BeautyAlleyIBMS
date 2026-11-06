import { requireServiceRole } from "../../db/supabase";
import { settingsRepository } from "../settings/settings.repository";
import type { Json } from "../../types/database";

/**
 * The built-in test gateway's store.
 *
 * Only the service role touches it: a test payment must not be readable or
 * writable by a browser session, even though it represents no money.
 */

export interface TestPayment {
  reference: string;
  amount_cents: number;
  currency: string;
  status: string;
  created_at: string;
  paid_at: string | null;
}

export const testPaymentsRepository = {
  async create(reference: string, amountCents: number): Promise<void> {
    const db = requireServiceRole();
    const { error } = await db.from("test_payment_requests").insert({
      reference,
      amount_cents: amountCents,
      currency: "PHP",
      status: "PENDING",
    });
    if (error) throw error;
  },

  async get(reference: string): Promise<TestPayment | null> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("test_payment_requests")
      .select("reference, amount_cents, currency, status, created_at, paid_at")
      .eq("reference", reference)
      .maybeSingle();
    if (error) throw error;
    return (data as TestPayment | null) ?? null;
  },

  async markPaid(reference: string): Promise<TestPayment | null> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("test_payment_requests")
      .update({ status: "PAID", paid_at: new Date().toISOString() })
      .eq("reference", reference)
      .eq("status", "PENDING")
      .select("reference, amount_cents, currency, status, created_at, paid_at")
      .maybeSingle();
    if (error) throw error;
    return (data as TestPayment | null) ?? null;
  },

  async cancel(reference: string): Promise<void> {
    const db = requireServiceRole();
    const { error } = await db
      .from("test_payment_requests")
      .update({ status: "CANCELLED" })
      .eq("reference", reference)
      .eq("status", "PENDING");
    if (error) throw error;
  },
};


/* ------------------------------------------------------------------ *
 * Booking deposits
 * ------------------------------------------------------------------ */

export interface BookingDepositRow {
  booking_id: string;
  amount_cents: number;
  status: string;
  provider: string;
  provider_ref: string | null;
  paid_at: string | null;
}

export type DepositCancelRule = "refund" | "forfeit" | "forfeit_if_late";

export interface DepositPolicy {
  enabled: boolean;
  amountCents: number;
  /** What happens to a held deposit when the booking is cancelled. */
  onCancel: DepositCancelRule;
}

const POLICY_KEY = "deposit.policy";
export const DEFAULT_DEPOSIT_POLICY: DepositPolicy = {
  enabled: false,
  amountCents: 50000,
  onCancel: "refund",
};

function normalisePolicy(value: unknown): DepositPolicy {
  const v = value as Partial<DepositPolicy> | null;
  return {
    enabled: typeof v?.enabled === "boolean" ? v.enabled : false,
    amountCents:
      typeof v?.amountCents === "number" && Number.isFinite(v.amountCents)
        ? v.amountCents
        : DEFAULT_DEPOSIT_POLICY.amountCents,
    onCancel:
      v?.onCancel === "forfeit" || v?.onCancel === "forfeit_if_late"
        ? v.onCancel
        : DEFAULT_DEPOSIT_POLICY.onCancel,
  };
}

export const bookingDepositsRepository = {
  async getPolicy(): Promise<DepositPolicy> {
    const row = await settingsRepository.get<Record<string, Json>>(POLICY_KEY);
    return normalisePolicy(row?.value ?? null);
  },

  async putPolicy(policy: DepositPolicy, actorId: string): Promise<void> {
    await settingsRepository.put(
      POLICY_KEY,
      { enabled: policy.enabled, amountCents: policy.amountCents, onCancel: policy.onCancel },
      actorId,
    );
  },

  /** Create the obligation. `onConflict` keeps a retried booking create safe. */
  async createForBooking(
    bookingId: string,
    amountCents: number,
    provider: string,
    providerRef: string,
  ): Promise<void> {
    const db = requireServiceRole();
    const { error } = await db
      .from("booking_deposits")
      .upsert(
        {
          booking_id: bookingId,
          amount_cents: amountCents,
          status: "DUE",
          provider,
          provider_ref: providerRef,
        },
        { onConflict: "booking_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  },

  async getForBooking(bookingId: string): Promise<BookingDepositRow | null> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("booking_deposits")
      .select("booking_id, amount_cents, status, provider, provider_ref, paid_at")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (error) throw error;
    return (data as BookingDepositRow | null) ?? null;
  },

  /** One query for a whole page, so lists do not do N+1 deposit reads. */
  async getForBookings(ids: string[]): Promise<Map<string, BookingDepositRow>> {
    if (ids.length === 0) return new Map();
    const db = requireServiceRole();
    const { data, error } = await db
      .from("booking_deposits")
      .select("booking_id, amount_cents, status, provider, provider_ref, paid_at")
      .in("booking_id", ids);
    if (error) throw error;
    return new Map(
      ((data ?? []) as BookingDepositRow[]).map((r) => [r.booking_id, r]),
    );
  },

  async getByRef(reference: string): Promise<BookingDepositRow | null> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("booking_deposits")
      .select("booking_id, amount_cents, status, provider, provider_ref, paid_at")
      .eq("provider_ref", reference)
      .maybeSingle();
    if (error) throw error;
    return (data as BookingDepositRow | null) ?? null;
  },

  /** Only the signed webhook may use this. Never exposed as a staff shortcut. */
  async markPaidByRef(reference: string): Promise<BookingDepositRow | null> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("booking_deposits")
      .update({ status: "PAID", paid_at: new Date().toISOString() })
      .eq("provider_ref", reference)
      .eq("status", "DUE")
      .select("booking_id, amount_cents, status, provider, provider_ref, paid_at")
      .maybeSingle();
    if (error) throw error;
    return (data as BookingDepositRow | null) ?? null;
  },

  /** Desk override for cash / bank transfer. Names the account that did it. */
  async markPaidByBooking(bookingId: string, actorId: string): Promise<BookingDepositRow | null> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("booking_deposits")
      .update({ status: "PAID", paid_at: new Date().toISOString(), marked_by: actorId })
      .eq("booking_id", bookingId)
      .eq("status", "DUE")
      .select("booking_id, amount_cents, status, provider, provider_ref, paid_at")
      .maybeSingle();
    if (error) throw error;
    return (data as BookingDepositRow | null) ?? null;
  },

  /** Desk decision: the obligation is dropped without payment. */
  async waiveByBooking(bookingId: string, actorId: string): Promise<BookingDepositRow | null> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("booking_deposits")
      .update({ status: "WAIVED", marked_by: actorId })
      .eq("booking_id", bookingId)
      .eq("status", "DUE")
      .select("booking_id, amount_cents, status, provider, provider_ref, paid_at")
      .maybeSingle();
    if (error) throw error;
    return (data as BookingDepositRow | null) ?? null;
  },

  /**
   * Close a deposit when its booking ends without being delivered.
   *
   * A DUE row was never money, so it becomes WAIVED; a PAID row becomes
   * REFUNDED or FORFEITED according to the owner's policy. Both statements
   * match only the states they expect, so a second call is a no-op.
   */
  async settleOnCancel(bookingId: string, forfeit: boolean): Promise<void> {
    const db = requireServiceRole();
    const { error } = await db
      .from("booking_deposits")
      .update({ status: forfeit ? "FORFEITED" : "REFUNDED" })
      .eq("booking_id", bookingId)
      .eq("status", "PAID");
    if (error) throw error;

    const { error: dueError } = await db
      .from("booking_deposits")
      .update({ status: "WAIVED" })
      .eq("booking_id", bookingId)
      .eq("status", "DUE");
    if (dueError) throw dueError;
  },
};
