import { requireServiceRole } from "../../db/supabase";

/**
 * The device table.
 *
 * Nothing here ever reads `token_hash` back out. The digest is compared inside
 * `authenticateDevice` and nowhere else, so no route and no log can leak it by
 * accident - the column is simply not in the select lists below.
 */
export interface KioskDeviceDto {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

/** The shape `create_kiosk_device` and `revoke_kiosk_device` return. */
type DeviceJson = {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export const kioskRepository = {
  /**
   * Every device, revoked ones included.
   *
   * Revoked rows stay in the list on purpose: "the tablet by the door" being
   * switched off is something the owner should be able to see, and re-using a
   * label for a replacement device is how they would otherwise lose the thread
   * of which one is which.
   */
  async list(): Promise<KioskDeviceDto[]> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("kiosk_devices")
      .select("id, label, created_at, last_seen_at, revoked_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return (data ?? []).map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at,
    }));
  },

  /**
   * Register a device from the *hash* of its secret.
   *
   * The secret is minted in the service and never passed here, so a failure in
   * this call leaves no usable credential anywhere - not in the table, not in
   * an error message.
   */
  async create(label: string, tokenHash: string, actorId: string | null): Promise<KioskDeviceDto> {
    const db = requireServiceRole();
    const { data, error } = await db.rpc("create_kiosk_device", {
      p_label: label,
      p_token_hash: tokenHash,
      p_actor: actorId,
    });

    if (error) throw error;
    return data as unknown as DeviceJson;
  },

  /**
   * Switch a device off. The row survives so past admissions stay attributable
   * to the screen that made them.
   */
  async revoke(id: string, actorId: string | null): Promise<KioskDeviceDto> {
    const db = requireServiceRole();
    const { data, error } = await db.rpc("revoke_kiosk_device", {
      p_id: id,
      p_actor: actorId,
    });

    if (error) throw error;
    return data as unknown as DeviceJson;
  },
};
