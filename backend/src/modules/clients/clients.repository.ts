import { requireServiceRole } from "../../db/supabase";

export interface ClientHitRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
}

export const clientsRepository = {
  /**
   * A lookup, not a record view.
   *
   * The booking form needs to answer "which Ada Cruz is this?" — a name, a
   * phone, an email. It does not need visit counts, lifetime value or notes,
   * and the desk is not being given the client record here. Inactive clients
   * are excluded because a booking cannot be attached to them.
   */
  async search(term: string, limit: number): Promise<ClientHitRow[]> {
    const db = requireServiceRole();
    // PostgREST reads commas and parentheses as filter syntax, so they cannot
    // survive into the pattern; the rest is escaped so % and _ are literal.
    const cleaned = term.replace(/[,()]/g, " ").trim();
    const safe = cleaned.replace(/[%_\\]/g, (m) => `\\${m}`);
    if (!safe) return [];

    const { data, error } = await db
      .from("clients")
      .select("id, full_name, phone, email")
      .eq("is_active", true)
      .or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`)
      .order("full_name", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as ClientHitRow[];
  },
};
