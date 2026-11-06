import { requireServiceRole } from "../../db/supabase";
import type { Json } from "../../types/database";

/**
 * The settings store.
 *
 * One row per key, JSONB value. The repository does not know what a payment
 * provider is; it only knows how to read and replace a key. That keeps the
 * shape of each setting in the service that owns it, and means a new setting
 * needs no data-layer change at all.
 */

export interface SettingRow<T extends Json> {
  key: string;
  value: T;
  updated_at: string;
  updated_by: string | null;
}

export interface ReminderStats {
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  /** The earliest PENDING send_at, or null when the queue is empty. */
  nextSendAt: string | null;
}

export const settingsRepository = {
  async get<T extends Json>(key: string): Promise<SettingRow<T> | null> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("app_settings")
      .select("key, value, updated_at, updated_by")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return (data as SettingRow<T> | null) ?? null;
  },

  async put<T extends Json>(key: string, value: T, actorId: string): Promise<SettingRow<T>> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("app_settings")
      .upsert({ key, value, updated_by: actorId }, { onConflict: "key" })
      .select("key, value, updated_at, updated_by")
      .single();
    if (error) throw error;
    return data as SettingRow<T>;
  },

  /**
   * Queue summary for the owner's Reminders panel. Reads only status and
   * send_at — never a recipient or a booking — because this endpoint is about
   * "is the mail working", not "who is being emailed".
   */
  async reminderStats(): Promise<ReminderStats> {
    const db = requireServiceRole();
    const { data, error } = await db.from("reminder_outbox").select("status, send_at");
    if (error) throw error;
    const rows = (data ?? []) as { status: string; send_at: string }[];
    const pending = rows
      .filter((r) => r.status === "PENDING")
      .map((r) => r.send_at)
      .sort();
    return {
      queued: pending.length,
      sent: rows.filter((r) => r.status === "SENT").length,
      failed: rows.filter((r) => r.status === "FAILED").length,
      skipped: rows.filter((r) => r.status === "SKIPPED").length,
      nextSendAt: pending[0] ?? null,
    };
  },
};
