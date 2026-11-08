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

/**
 * The verdict from `verify_staff_pin`.
 *
 * A discriminated union rather than an exception, because the throttle has to
 * be *recorded* on a miss and an exception would roll the counter back. The
 * database decides; this type is the whole of its vocabulary.
 */
export type PinVerdict =
  | { ok: true; employeeId: string; fullName: string }
  | { ok: false; reason: "INVALID"; attemptsLeft: number }
  | { ok: false; reason: "LOCKED"; retryAfterSeconds: number }
  | { ok: false; reason: "INACTIVE"; employeeId: string };

/**
 * What `kiosk_arrival` returns. Deliberately narrow: this is what a screen in a
 * public lobby may know. No phone number, no client id, no money, no notes.
 */
export interface ArrivalSummary {
  reference: string;
  status: string;
  startTime: string;
  endTime: string;
  guestName: string | null;
  staffName: string | null;
  services: string[];
  passUsed: boolean;
  passRevoked: boolean;
  passExpiresAt: string;
  depositDue: boolean;
}

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

  /**
   * Check a PIN and throttle the device in one transaction.
   *
   * The lookup is computed in the service from the pepper; nothing here sees
   * the digits. The function takes the device id so the counter is per screen,
   * and returns a verdict rather than raising so a miss is still counted.
   */
  async verifyPin(kioskId: string, pinLookup: string): Promise<PinVerdict> {
    const db = requireServiceRole();
    const { data, error } = await db.rpc("verify_staff_pin", {
      p_kiosk_id: kioskId,
      p_pin_lookup: pinLookup,
    });

    if (error) throw error;
    return data as unknown as PinVerdict;
  },

  /** The arrival summary for one pass. Raises QR_INVALID for an unknown jti. */
  async arrival(jti: string): Promise<ArrivalSummary> {
    const db = requireServiceRole();
    const { data, error } = await db.rpc("kiosk_arrival", { p_jti: jti });

    if (error) throw error;
    return data as unknown as ArrivalSummary;
  },
};
