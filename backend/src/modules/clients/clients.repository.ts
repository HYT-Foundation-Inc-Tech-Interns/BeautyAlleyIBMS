import { requireServiceRole } from "../../db/supabase";
import { AppError, CODES } from "../../lib/errors";

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

  /**
   * Give a login to a client record, or make the record for it.
   *
   * The desk meets both cases on the same day. A regular who has been booked
   * as a guest already has a row in `clients` with no `profile_id`; linking is
   * all that is needed, and creating a second row would split their history in
   * two. A brand-new client has no row at all, so one is inserted with the new
   * profile attached.
   *
   * Matching is by email first, then phone, both of which are citext. A row
   * that already carries a profile is a conflict, not something to overwrite:
   * two logins must never share one client.
   */
  /**
   * The login attached to a client record, if there is one.
   *
   * A client row can exist without an account - every guest booking makes one -
   * so `profileId` being null is a normal answer, not a failure.
   */
  async accountOf(clientId: string): Promise<{ profileId: string | null; fullName: string } | null> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("clients")
      .select("profile_id, full_name")
      .eq("id", clientId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      profileId: (data as { profile_id: string | null }).profile_id,
      fullName: (data as { full_name: string }).full_name,
    };
  },

  async linkOrCreateForProfile(input: {
    profileId: string;
    fullName: string;
    email: string;
    phone?: string | null;
  }): Promise<string> {
    const db = requireServiceRole();

    const { data: byEmail, error: emailError } = await db
      .from("clients")
      .select("id, profile_id")
      .eq("email", input.email)
      .limit(1)
      .maybeSingle();
    if (emailError) throw emailError;

    let existing = byEmail as { id: string; profile_id: string | null } | null;

    if (!existing && input.phone) {
      const { data: byPhone, error: phoneError } = await db
        .from("clients")
        .select("id, profile_id")
        .eq("phone", input.phone)
        .limit(1)
        .maybeSingle();
      if (phoneError) throw phoneError;
      existing = byPhone as { id: string; profile_id: string | null } | null;
    }

    if (existing) {
      if (existing.profile_id && existing.profile_id !== input.profileId) {
        throw AppError.conflict(
          CODES.CONFLICT,
          "That client already has a login. Reset that password instead."
        );
      }
      const { error } = await db
        .from("clients")
        .update({ profile_id: input.profileId, email: input.email })
        .eq("id", existing.id);
      if (error) throw error;
      return existing.id;
    }

    const { data: created, error: insertError } = await db
      .from("clients")
      .insert({
        profile_id: input.profileId,
        full_name: input.fullName,
        email: input.email,
        phone: input.phone || null,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    return (created as { id: string }).id;
  },
};
