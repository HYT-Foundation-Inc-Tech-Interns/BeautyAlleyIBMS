/**
 * Timestamp serialisation.
 *
 * Two different layers render `timestamptz` and they disagree on the spelling
 * of the same instant:
 *
 *   * PostgREST renders a `timestamptz` column as `2026-10-26T04:00:00+00:00`;
 *   * a PL/pgSQL function returning `jsonb` produces a value that supabase-js
 *     re-serialises as `2026-10-26T04:00:00.000Z`.
 *
 * Both are valid ISO-8601 and denote the same moment, but a client cannot
 * compare them as strings, and neither can a test. Before this module the API
 * returned both spellings depending on which code path produced the value -
 * `/availability` said `+00:00` while `/bookings` said `Z` for the same kind of
 * field.
 *
 * Everything that leaves the API through a DTO is passed through `iso()`, so
 * the wire format is `Z`-suffixed UTC everywhere. This is a representation
 * change only; the instant is unchanged.
 */

import { env } from "../config/env";

/**
 * Normalise a timestamp string to `Z`-suffixed ISO-8601.
 *
 * Unparseable input is returned unchanged rather than throwing or becoming
 * `Invalid Date`. A DTO mapper is the wrong place to fail - a malformed value
 * is a data problem, and replacing it with an exception would turn one bad row
 * into a 500 for the whole request.
 */
export function iso(value: string | null | undefined): string {
  if (value === null || value === undefined) return value as unknown as string;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** As `iso()`, but preserves null so an optional field stays optional. */
export function isoOrNull(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : iso(value);
}

/**
 * The branch's calendar day for an instant, as `YYYY-MM-DD`.
 *
 * "Today" is the salon's local day, not UTC's. At 09:00 in Manila it is still
 * the previous day in UTC, so a UTC-derived day would file the morning shift
 * under yesterday - the same trap migration 26 documents for the quota, and
 * migration 29 for attendance.
 *
 * Built from `formatToParts` rather than by slicing a formatted string, so the
 * result does not depend on the locale's chosen separator. (`en-CA` happens to
 * render `YYYY-MM-DD`, but that is a property of the locale data, not a
 * guarantee this code should lean on.)
 */
export function branchDay(instant: Date = new Date(), timeZone: string = env.branchTimezone): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** The offset of `timeZone` from UTC, in minutes, at a given instant. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wallClock = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    pick("hour") % 24,
    pick("minute"),
    pick("second")
  );
  return (wallClock - instant.getTime()) / 60000;
}

/**
 * The instant a branch day begins.
 *
 * `branchDay()` answers "which day is this instant in"; this is the inverse,
 * and it is the one a date filter needs. Filtering `start_time` against
 * `${day}T00:00:00Z` uses UTC's midnight, so in Manila every appointment
 * before 08:00 local sits on the previous UTC day and falls outside "today" -
 * a 07:00 booking disappears from the day it belongs to and reappears in the
 * one before it. The day is the salon's, so the boundary has to be the
 * salon's too.
 *
 * Two passes, because the offset at UTC midnight is not necessarily the offset
 * at the instant we are looking for. Manila has no daylight saving and one
 * pass would do, but a helper that only works in one timezone is a trap.
 */
export function branchDayStart(day: string, timeZone: string = env.branchTimezone): Date {
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  const first = offsetMinutes(utcMidnight, timeZone);
  const guess = new Date(utcMidnight.getTime() - first * 60000);
  const second = offsetMinutes(guess, timeZone);
  return new Date(utcMidnight.getTime() - second * 60000);
}

/** The branch day after `day`, as `YYYY-MM-DD`. */
export function nextBranchDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}
