import type { NextFunction, Request, Response } from "express";
import { requireServiceRole } from "../db/supabase";
import { AppError, CODES } from "../lib/errors";
import { deviceSecretMatches, parseKioskToken } from "../lib/kioskToken";
import { bearer } from "./authenticate";

/**
 * How often a device's last-seen stamp is refreshed.
 *
 * A kiosk polls the API all day. Writing on every request would turn a screen
 * that does nothing into a steady stream of updates to one row, and the value
 * of the stamp is "is this device alive" - a minute of resolution is plenty for
 * that question.
 */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Resolve a device token into `req.kiosk`.
 *
 * Three checks, in this order, because each one is cheaper than the next:
 *
 * 1. **Shape.** `parseKioskToken` rejects anything that is not
 *    `kiosk.<uuid>.<43 chars>`. A staff JWT or a booking pass stops here,
 *    with no database call at all.
 * 2. **Row.** The device must exist. This is what makes revocation immediate:
 *    a self-contained token could not be withdrawn, and a kiosk that walks out
 *    of the salon is exactly the case this has to survive.
 * 3. **Secret.** sha256 of the presented secret must equal the stored digest,
 *    compared in constant time.
 *
 * The row is read *before* the secret is compared, which is not the order that
 * matters for security - it matters for the message. A wrong secret and an
 * unknown id both end at KIOSK_TOKEN_INVALID, so the two paths are
 * indistinguishable to a caller either way.
 *
 * This never sets `req.actor`. A kiosk is not a person, and any route that
 * needs a person should be mounted behind `authenticate` instead.
 */
export async function authenticateDevice(req: Request, _res: Response, next: NextFunction) {
  try {
    const raw = bearer(req);
    if (!raw) return next(AppError.unauthorized());

    const parsed = parseKioskToken(raw);
    if (!parsed) {
      return next(AppError.unauthorized(CODES.KIOSK_TOKEN_INVALID, "This device is not signed in"));
    }

    // Service role: `kiosk_devices` has RLS enabled with no policies, so an
    // anon-key read returns nothing at all. The device is the credential, not
    // a database session.
    const db = requireServiceRole();
    const { data, error } = await db
      .from("kiosk_devices")
      .select("id, label, token_hash, last_seen_at, revoked_at")
      .eq("id", parsed.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return next(AppError.unauthorized(CODES.KIOSK_TOKEN_INVALID, "This device is not signed in"));
    }

    if (!deviceSecretMatches(parsed.secret, data.token_hash)) {
      return next(AppError.unauthorized(CODES.KIOSK_TOKEN_INVALID, "This device is not signed in"));
    }

    // Checked after the secret, so a revoked device cannot be used to probe
    // which ids exist: a wrong secret on a revoked device is still
    // KIOSK_TOKEN_INVALID.
    if (data.revoked_at) {
      return next(
        AppError.forbidden(CODES.KIOSK_REVOKED, "This kiosk has been switched off")
      );
    }

    req.kiosk = { id: data.id, label: data.label };

    touch(data.id, data.last_seen_at, req.ip);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Refresh `last_seen_at`, at most once a minute.
 *
 * Deliberately not awaited and deliberately silent. This is a diagnostic -
 * "when did that screen last check in" - and a failed write must not stop a
 * guest being admitted at the door. The promise is settled either way so a
 * network error cannot surface as an unhandled rejection.
 */
function touch(id: string, lastSeenAt: string | null, ip: string | undefined) {
  const last = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  if (Number.isFinite(last) && Date.now() - last < TOUCH_INTERVAL_MS) return;

  requireServiceRole()
    .from("kiosk_devices")
    .update({ last_seen_at: new Date().toISOString(), last_seen_ip: ip ?? null })
    .eq("id", id)
    .then(
      () => undefined,
      () => undefined
    );
}
