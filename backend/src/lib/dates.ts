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
