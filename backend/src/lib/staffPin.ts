/**
 * The door PIN.
 *
 * A stylist types four to six digits at the tablet, and that string has to
 * answer two questions at once: is it right, and *whose* is it? The screen
 * knows no employee id, and letting it name one would mean a stolen device
 * could admit guests under any name it liked. So the PIN is looked up by
 * value, which rules out a per-row salt - the same salt problem a login has,
 * solved the other way round.
 *
 * What stands in for the salt is a pepper held in the API's environment:
 *
 *     pin_lookup = HMAC-SHA256(KIOSK_PIN_PEPPER, "staff-pin:" || pin)
 *
 * A plain sha256 would be useless here. Four digits is 10,000 candidates, so an
 * unkeyed digest of this table is a 10,000-row lookup table - reversible on a
 * laptop. With the pepper, a dump of `staff_pins` says nothing at all.
 *
 * Two operational facts follow, and both are in the runbook:
 *
 *   * the pepper must be set before any PIN can be issued. Missing is a 503,
 *     not a silent fallback to an unkeyed hash;
 *   * changing it invalidates every PIN, because every lookup was derived from
 *     the old one.
 *
 * The `staff-pin:` prefix is domain separation. It costs nothing and means this
 * pepper cannot be reused by accident for something else that hashes a short
 * secret - a session token, a promo code - without the two colliding.
 */

import { createHmac } from "crypto";
import { env } from "../config/env";
import { AppError } from "./errors";

/**
 * Four to six digits.
 *
 * Four is what a person can type at a door without thinking about it; six is
 * the ceiling because the PIN is typed in public and read by anyone standing
 * behind. Longer would be a password, and a password at a lobby tablet is how
 * you get a queue.
 */
export const PIN_PATTERN = /^\d{4,6}$/;

/**
 * The blind index for a PIN.
 *
 * Throws a 503 when the pepper is unset rather than hashing with an empty key.
 * An unkeyed HMAC is not a weaker version of this - it is a different thing,
 * and one whose output would silently stop matching the day the pepper is
 * configured. Refusing is the only honest answer.
 */
export function pinLookup(pin: string): string {
  const pepper = env.kioskPinPepper;
  if (!pepper) {
    throw AppError.config(
      "KIOSK_PIN_PEPPER is not configured, so door PINs are unavailable. " +
        "Add it to the API environment and restart."
    );
  }

  return createHmac("sha256", pepper).update(`staff-pin:${pin}`).digest("hex");
}

/** Whether the pepper is present, so a screen can say "not set up" instead of failing. */
export function hasPinPepper(): boolean {
  return env.kioskPinPepper.length > 0;
}
