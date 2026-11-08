/**
 * The kiosk device credential.
 *
 * A kiosk is a screen by the door, not a person. It cannot hold an email and a
 * password nobody types, and it must not be able to do anything except look up
 * an arrival pass and ask for a staff PIN. So it gets a credential of its own,
 * shaped like this:
 *
 *     kiosk.<device uuid>.<43-char base64url secret>
 *
 * Two things are deliberately separate, for the same reason `lib/qr.ts` keeps
 * a signature and a database row apart:
 *
 *   * the **hash** proves the caller holds the secret we issued - the database
 *     stores only `sha256(secret)`, so a leaked table is not a usable token;
 *   * the **row** is what makes revocation immediate. A self-contained signed
 *     token could not be withdrawn, and a kiosk that walks out of the salon is
 *     exactly the case this has to survive.
 *
 * The device id is in the clear. It is not a secret: it selects the row, and
 * the hash comparison is what authenticates. Putting it first also lets the
 * `authenticate` middleware reject a kiosk token without a GoTrue round trip,
 * and lets this middleware reject a staff JWT without a database hit.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";

const PREFIX = "kiosk";
/** 32 bytes of CSPRNG, base64url: 43 characters, no padding. */
const SECRET_BYTES = 32;
const SECRET_LENGTH = 43;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeviceSecret {
  /** What the owner copies onto the device. Shown once, never stored. */
  secret: string;
  /** What the database keeps. */
  hash: string;
}

export function hashDeviceSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * A fresh secret and the digest to store.
 *
 * The id is not known yet - the row generates it - and it is not part of the
 * hash, so the token is assembled after the insert. That order matters: a
 * failed insert leaves no usable credential anywhere.
 */
export function createDeviceSecret(): DeviceSecret {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  return { secret, hash: hashDeviceSecret(secret) };
}

export function formatKioskToken(id: string, secret: string): string {
  return `${PREFIX}.${id}.${secret}`;
}

/**
 * Split a token, or return null.
 *
 * Strict on purpose: exactly three parts, the right prefix, a uuid-shaped id,
 * and a secret of exactly the length this module issues. Anything else is a
 * staff JWT, a booking pass, a truncated paste, or an attempt - and all four
 * should reach the same 401 without a query.
 */
export function parseKioskToken(raw: string): { id: string; secret: string } | null {
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [prefix, id, secret] = parts;
  if (prefix !== PREFIX) return null;
  if (!UUID.test(id)) return null;
  if (secret.length !== SECRET_LENGTH) return null;
  return { id, secret };
}

/**
 * Compare a presented secret with the stored hash.
 *
 * `timingSafeEqual` throws on a length mismatch, which is why the length is
 * checked first - an attacker-supplied short string must not turn a refusal
 * into a 500.
 */
export function deviceSecretMatches(secret: string, storedHash: string): boolean {
  const presented = Buffer.from(hashDeviceSecret(secret), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (presented.length !== stored.length || stored.length === 0) return false;
  return timingSafeEqual(presented, stored);
}
