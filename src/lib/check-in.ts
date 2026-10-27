/**
 * Admitting a guest, the way the scanner does.
 *
 * `PATCH /bookings/:id/status` can write `CHECKED_IN`, and for a while that was
 * how every console button did it. A status write is not a check-in, though: it
 * leaves the guest's pass live, writes no `checkins` row, and never looks at
 * the arrival window — so the desk could admit somebody booked three days out,
 * and the record would say they arrived without saying who let them in or when.
 *
 * The one path that does all of it is redeeming the pass through
 * `POST /qr/check-in`: it burns the token, stamps the check-in with the staff
 * member who made it, and enforces the same window the door scanner does. That
 * endpoint needs a live pass, so one is issued for this booking first — the same
 * two steps the scan-arrivals page takes, in one call.
 *
 * If there is no live pass left, the booking has already been admitted (or
 * cancelled), and saying so is better than quietly writing the status again.
 */

import { api, ApiError } from "./api";
import type { CheckInResult } from "./api-types";

export async function checkInBooking(
  bookingId: string,
  opts: { force?: boolean } = {},
): Promise<CheckInResult> {
  const qr = await api.bookings.qr(bookingId);
  if (!qr.pass) {
    throw new ApiError(
      409,
      "ALREADY_CHECKED_IN",
      "This booking has no live pass left to redeem — it has already been admitted.",
    );
  }
  return api.qr.checkIn(qr.pass, opts.force === true);
}

/**
 * The guest is here before their pass opens.
 *
 * Its own predicate because every screen that admits a guest has to catch this
 * one code and offer the same choice: wait, or override the window on the
 * record. Anything else is an ordinary failure.
 */
export function isEarlyArrival(err: unknown): boolean {
  return err instanceof ApiError && err.code === "QR_TOO_EARLY";
}
