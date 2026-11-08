/**
 * Reading an arrival pass.
 *
 * A pass reaches the API in more than one shape: the raw `BA1.<body>.<sig>`
 * token from a QR scanner, or the URL it was encoded in, from a phone's camera
 * app or a link someone pasted. Both are the same credential, so both are
 * accepted, and the unwrapping lives here rather than being repeated by every
 * caller.
 *
 * The other job is the arrival window. `check_in_booking` decides it in SQL -
 * that is the authority - but a screen has to *say* what will happen before it
 * calls: "this pass opens at 13:00" is a better answer than a 400 after the
 * fact. `arrivalState` mirrors the SQL rule using `passWindow`, which is the
 * same function the pass renderer uses, so the three cannot disagree about
 * where the window starts.
 *
 * Nothing here touches the database. Everything is a pure function of the pass
 * and the clock, which is what makes it testable without one.
 */

import { AppError, CODES } from "./errors";
import { passWindow, verifyQrPass, type QrPayload } from "./qr";

/**
 * The token inside whatever the caller handed us.
 *
 * A URL is only unwrapped when it actually carries a `pass` parameter. A URL
 * that does not is left alone so the verifier rejects it as malformed, rather
 * than this function inventing a token out of a path segment.
 */
export function normalisePass(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    return url.searchParams.get("pass")?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Verify a pass and return its payload, or throw the error the API reports.
 *
 * The three failure reasons collapse into two codes on purpose: a malformed
 * token and a bad signature are both "that is not a pass we issued", and
 * telling a caller which is a hint about how to forge one. An expired pass is
 * different - the guest has done nothing wrong and the screen should say so.
 */
export function verifyArrivalPass(raw: string): QrPayload {
  const verified = verifyQrPass(normalisePass(raw));

  if (!verified.ok) {
    if (verified.reason === "EXPIRED") {
      throw AppError.badRequest(CODES.QR_EXPIRED, "That check-in code has expired.");
    }
    throw AppError.badRequest(CODES.QR_INVALID, "That check-in code is not valid.");
  }

  return verified.payload;
}

export type ArrivalState = "EARLY" | "OPEN" | "LATE";

/**
 * Where this arrival sits relative to the window `check_in_booking` enforces:
 * `[start − windowMinutes, end]`.
 *
 * Inclusive at both ends, matching the SQL, which refuses only `now < from`
 * and `now > until`.
 */
export function arrivalState(
  startTime: string,
  endTime: string,
  windowMinutes: number,
  now: Date = new Date()
): ArrivalState {
  const { admitFrom, admitUntil } = passWindow(startTime, endTime, windowMinutes);
  if (now.getTime() < Date.parse(admitFrom)) return "EARLY";
  if (now.getTime() > Date.parse(admitUntil)) return "LATE";
  return "OPEN";
}

/**
 * Why this arrival cannot be admitted right now, or null if it can.
 *
 * This is a *prediction*, not a gate. `check_in_booking` re-checks every one of
 * these inside its own transaction, and that is what actually decides - the
 * point of this function is that the screen can say "this booking was
 * cancelled" instead of offering a button that fails.
 *
 * Order matters, and it is the order a person at the door needs:
 *
 *   already in -> the booking is closed -> the pass is dead -> money owed ->
 *   the pass has expired -> the time is wrong
 *
 * A cancelled booking whose pass also expired should read "cancelled", not
 * "expired": the first explains why they are not expected, the second invites
 * them to try again tomorrow.
 */
export type AdmissionBlocker =
  | "ALREADY_CHECKED_IN"
  | "BOOKING_CLOSED"
  | "PASS_REVOKED"
  | "DEPOSIT_DUE"
  | "PASS_EXPIRED"
  | "TOO_EARLY"
  | "TOO_LATE";

export interface ArrivalFacts {
  status: string;
  passUsed: boolean;
  passRevoked: boolean;
  passExpiresAt: string;
  depositDue: boolean;
}

export function admissionBlocker(
  facts: ArrivalFacts,
  state: ArrivalState,
  now: Date = new Date()
): AdmissionBlocker | null {
  if (facts.status === "CHECKED_IN" || facts.passUsed) return "ALREADY_CHECKED_IN";
  if (["CANCELLED", "COMPLETED", "NO_SHOW"].includes(facts.status)) return "BOOKING_CLOSED";
  if (facts.passRevoked) return "PASS_REVOKED";
  if (facts.depositDue) return "DEPOSIT_DUE";
  if (now.getTime() >= Date.parse(facts.passExpiresAt)) return "PASS_EXPIRED";
  if (state === "EARLY") return "TOO_EARLY";
  if (state === "LATE") return "TOO_LATE";
  return null;
}
