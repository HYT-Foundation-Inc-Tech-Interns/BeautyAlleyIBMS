/**
 * The door tablet's credential, and where it lives.
 *
 * A screen is provisioned by opening a link the owner copies out of Settings:
 *
 *     https://…/kiosk#t=kiosk.<device uuid>.<43-char secret>
 *
 * ## Why the fragment
 *
 * The token is in the *fragment*, not the query string. A fragment is never
 * sent to the server, so it cannot turn up in an access log, a proxy cache or a
 * `Referer` header. The screen then strips it from the address bar as soon as
 * it has been read: a guest standing at the tablet should not be able to
 * photograph the URL and walk away with the credential.
 *
 * ## Why localStorage, and why that is still safe
 *
 * A tablet that loses power overnight has to come back by itself. Session
 * storage would mean the screen dies at midnight and stays dead until somebody
 * with an owner login walks over to it, which in practice means it stays dead.
 *
 * The lifetime of the credential is therefore controlled by *revoking the
 * device* in Settings, not by the storage. That is the right control anyway:
 * the token is a property of a piece of hardware on a wall, not of a browser
 * session, and revocation is immediate on the next request.
 */

const KEY = "ba.kiosk.token";

/**
 * The shape `lib/kioskToken.ts` mints on the server.
 *
 * Checked here so a truncated paste or a half-copied link fails as "this screen
 * is not set up" instead of being stored and then rejected by the API with a
 * message about a device that does not exist.
 */
const SHAPE = /^kiosk\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/;

export function deviceTokenShape(token: string): boolean {
  return SHAPE.test(token);
}

/** The stored credential, or null when this browser has never been set up. */
export function readDeviceToken(): string | null {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch {
    // Private mode and some kiosk browsers refuse storage outright. The screen
    // still works for this visit; it just cannot remember the token.
    return null;
  }
  return stored && SHAPE.test(stored) ? stored : null;
}

/**
 * Take a token out of the URL, if there is one, and make it the device's own.
 *
 * Always strips the fragment, whether or not the token was usable: leaving a
 * bad one in the address bar means the next reload re-reads it, and the person
 * setting the tablet up gets the same silent failure twice.
 */
export function adoptDeviceToken(): string | null {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return null;

  const params = new URLSearchParams(hash.slice(1));
  const raw = params.get("t")?.trim();
  if (!raw) return null;

  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );

  if (!SHAPE.test(raw)) return null;

  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    /* the token is still returned; it just will not survive a reload */
  }
  return raw;
}

/** Forget the credential on this browser. Revoking it is a separate act. */
export function forgetDeviceToken() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing stored to remove */
  }
}
