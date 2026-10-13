import { requireServiceRole } from "../../db/supabase";
import type { Database } from "../../types/database";

type LoyaltyRow = Database["public"]["Views"]["v_client_loyalty"]["Row"];

const SELECT =
  "client_id, full_name, phone, email, member_since, discount_percent, completed_visits, eligible_for_membership" as const;

export interface PromoteResult {
  clientId: string;
  memberSince: string;
  discountPercent: number;
  completedVisits: number;
  threshold: number;
}

export const loyaltyRepository = {
  /**
   * The loyalty row for one client, or null.
   *
   * Reads the derived view, never a stored counter: `completed_visits` is
   * recomputed from COMPLETED bookings on every read, so cancelling an
   * appointment corrects it instead of leaving the client permanently one
   * visit ahead of reality.
   */
  async byClientId(clientId: string): Promise<LoyaltyRow | null> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("v_client_loyalty")
      .select(SELECT)
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) throw error;
    return (data as LoyaltyRow) ?? null;
  },

  /** Lookup by phone, for the walk-in "have you been here before?" step. */
  async byPhone(phone: string): Promise<LoyaltyRow | null> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("v_client_loyalty")
      .select(SELECT)
      // phone is citext in the database, so the comparison is already
      // case-insensitive; trimming here handles a trailing space from a form.
      .eq("phone", phone.trim())
      .maybeSingle();
    if (error) throw error;
    return (data as LoyaltyRow) ?? null;
  },

  /**
   * Every client with their derived visit count.
   *
   * `eligible_only` is filtered in Node rather than in SQL because the flag is
   * computed by the view and PostgREST cannot filter on a computed column
   * without a second view. The client table is small enough for that to be
   * free, and the alternative - a stored `eligible` flag - is exactly the
   * denormalisation migration 17 set out to avoid.
   */
  async list(opts: { eligibleOnly: boolean; memberOnly: boolean; q?: string }): Promise<LoyaltyRow[]> {
    const db = requireServiceRole();
    let q = db.from("v_client_loyalty").select(SELECT);

    if (opts.memberOnly) q = q.not("member_since", "is", null);
    if (opts.q) {
      // Escape the LIKE metacharacters so a search for "100%" is a search for
      // that text, not a wildcard.
      const safe = opts.q.replace(/[%_\\]/g, (m) => `\\${m}`);
      q = q.or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%`);
    }

    const { data, error } = await q.order("full_name");
    if (error) throw error;

    const rows = (data ?? []) as LoyaltyRow[];
    return opts.eligibleOnly ? rows.filter((r) => r.eligible_for_membership) : rows;
  },

  /** The configured threshold, read from the database rather than hardcoded. */
  async threshold(): Promise<number> {
    const db = requireServiceRole();
    const { data, error } = await db.rpc("membership_visit_threshold");
    if (error) throw error;
    return typeof data === "number" ? data : 3;
  },

  /**
   * Promote a client. Delegates to `promote_client()` so the eligibility rule
   * and the audit entry are applied by the database, not re-implemented here -
   * a TypeScript copy would be a second source of truth that could disagree.
   */
  async promote(clientId: string, discountPercent: number, actorId: string | null) {
    const db = requireServiceRole();
    const { data, error } = await db.rpc("promote_client", {
      p_client_id: clientId,
      p_discount_percent: discountPercent,
      p_actor: actorId,
    });
    if (error) throw error;
    return data as PromoteResult;
  },

  async revoke(clientId: string, actorId: string | null) {
    const db = requireServiceRole();
    const { data, error } = await db.rpc("revoke_membership", {
      p_client_id: clientId,
      p_actor: actorId,
    });
    if (error) throw error;
    return data as { clientId: string; memberSince: null; discountPercent: number };
  },
};
