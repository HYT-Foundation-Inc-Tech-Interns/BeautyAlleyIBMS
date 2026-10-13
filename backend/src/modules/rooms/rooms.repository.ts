import { requireServiceRole, supabasePublic } from "../../db/supabase";
import { toRange } from "../../lib/pagination";
import type { Database } from "../../types/database";
import type {
  AvailableRoomsQuery,
  CreateRoomInput,
  ListRoomsQuery,
  UpdateRoomInput,
} from "./rooms.schemas";

type RoomTypeColumn = Database["public"]["Tables"]["rooms"]["Row"]["room_type"];
type RoomStatusColumn = Database["public"]["Tables"]["bookings"]["Row"]["status"];

export interface RoomRow {
  id: string;
  name: string;
  room_type: RoomTypeColumn;
  capacity: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const SELECT =
  "id, name, room_type, capacity, notes, is_active, created_at, updated_at" as const;

type RoomUpdate = Database["public"]["Tables"]["rooms"]["Update"];

/**
 * A booking status that still holds the room. Mirrors the `where` clause on the
 * `bookings_room_no_overlap` exclusion constraint in migration 17 - if the two
 * ever disagree, the preview would offer a room the constraint then rejects.
 */
const LIVE_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN", "IN_SERVICE", "COMPLETED"] as const;

export const roomsRepository = {
  async list(query: ListRoomsQuery): Promise<{ rows: RoomRow[]; total: number }> {
    const db = requireServiceRole();
    const { from, to } = toRange(query);

    let q = db.from("rooms").select(SELECT, { count: "exact" });
    if (!query.includeInactive) q = q.eq("is_active", true);
    if (query.roomType) q = q.eq("room_type", query.roomType);

    const { data, error, count } = await q
      .order(query.sort, { ascending: query.order === "asc" })
      .range(from, to);
    if (error) throw error;
    return { rows: (data ?? []) as RoomRow[], total: count ?? 0 };
  },

  /**
   * Public catalogue read. RLS (`rooms_public_read`) already limits anon to
   * active rows, but the filter is repeated here so the two clients agree.
   */
  async listPublic() {
    const { data, error } = await supabasePublic
      .from("rooms")
      .select(SELECT)
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    return (data ?? []) as RoomRow[];
  },

  async getById(id: string): Promise<RoomRow | null> {
    const db = requireServiceRole();
    const { data, error } = await db.from("rooms").select(SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as RoomRow) ?? null;
  },

  /**
   * Rooms of the requested type with no live booking overlapping [start, end).
   *
   * Two queries rather than one: PostgREST cannot express a range `&&` test, and
   * fetching the busy room ids separately keeps the overlap rule written once,
   * in `overlappingRoomIds`, instead of split across an embedded filter.
   *
   * The comparison is half-open - `start_time < end and end_time > start` - which
   * is exactly what `tstzrange(a, b) && tstzrange(c, d)` means. A 09:00-10:00
   * and a 10:00-11:00 booking in one room are therefore adjacent, not clashing.
   */
  async findAvailable(opts: {
    start: string;
    end: string;
    roomType?: RoomTypeColumn;
    ignoreBookingId?: string;
  }): Promise<RoomRow[]> {
    const db = requireServiceRole();

    let roomsQ = db.from("rooms").select(SELECT).eq("is_active", true);
    if (opts.roomType) roomsQ = roomsQ.eq("room_type", opts.roomType);

    const { data: rooms, error: roomsErr } = await roomsQ.order("name");
    if (roomsErr) throw roomsErr;
    const candidates = (rooms ?? []) as RoomRow[];
    if (candidates.length === 0) return [];

    const busy = await this.overlappingRoomIds({
      start: opts.start,
      end: opts.end,
      roomIds: candidates.map((r) => r.id),
      ignoreBookingId: opts.ignoreBookingId,
    });

    return candidates.filter((r) => !busy.has(r.id));
  },

  /** Ids of rooms holding a live booking that overlaps [start, end). */
  async overlappingRoomIds(opts: {
    start: string;
    end: string;
    roomIds: string[];
    ignoreBookingId?: string;
  }): Promise<Set<string>> {
    if (opts.roomIds.length === 0) return new Set();
    const db = requireServiceRole();

    let q = db
      .from("bookings")
      .select("room_id")
      .in("room_id", opts.roomIds)
      .in("status", LIVE_STATUSES as unknown as RoomStatusColumn[])
      // Half-open overlap: the existing booking starts before ours ends and
      // ends after ours starts.
      .lt("start_time", opts.end)
      .gt("end_time", opts.start);

    if (opts.ignoreBookingId) q = q.neq("id", opts.ignoreBookingId);

    const { data, error } = await q;
    if (error) throw error;
    return new Set((data ?? []).map((r) => r.room_id as string));
  },

  /**
   * The first free room of a type, by name. Used by the auto-assigner inside
   * `create_booking`; ordering by name makes the choice deterministic, so the
   * same booking always lands in the same room and the desk can predict it.
   */
  async firstAvailable(opts: {
    start: string;
    end: string;
    roomType: RoomTypeColumn;
  }): Promise<RoomRow | null> {
    const free = await this.findAvailable(opts);
    return free[0] ?? null;
  },

  async create(input: CreateRoomInput): Promise<RoomRow> {
    const db = requireServiceRole();
    const { data, error } = await db
      .from("rooms")
      .insert({
        name: input.name,
        room_type: input.roomType,
        capacity: input.capacity,
        notes: input.notes ?? null,
        is_active: input.isActive,
      })
      .select(SELECT)
      .single();
    if (error) throw error;
    return data as RoomRow;
  },

  async update(id: string, patch: UpdateRoomInput): Promise<RoomRow | null> {
    const db = requireServiceRole();
    const row: RoomUpdate = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.roomType !== undefined) row.room_type = patch.roomType;
    if (patch.capacity !== undefined) row.capacity = patch.capacity;
    if (patch.notes !== undefined) row.notes = patch.notes;
    if (patch.isActive !== undefined) row.is_active = patch.isActive;

    if (Object.keys(row).length === 0) return this.getById(id);

    const { data, error } = await db
      .from("rooms")
      .update(row)
      .eq("id", id)
      .select(SELECT)
      .maybeSingle();
    if (error) throw error;
    return (data as RoomRow) ?? null;
  },

  /** How many live bookings currently reference the room. */
  async liveBookingCount(roomId: string): Promise<number> {
    const db = requireServiceRole();
    const { count, error } = await db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("room_id", roomId)
      .in("status", LIVE_STATUSES as unknown as RoomStatusColumn[]);
    if (error) throw error;
    return count ?? 0;
  },

  /**
   * Bookings that would make this room unusable right now - the reason a
   * decommission is refused.
   */
  async futureBookingsFor(roomId: string): Promise<number> {
    const db = requireServiceRole();
    const { count, error } = await db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("room_id", roomId)
      .in("status", ["PENDING", "CONFIRMED"] as unknown as RoomStatusColumn[])
      .gte("end_time", new Date().toISOString());
    if (error) throw error;
    return count ?? 0;
  },
};
