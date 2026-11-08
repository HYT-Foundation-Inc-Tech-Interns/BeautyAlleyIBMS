#!/usr/bin/env node
"use strict";

/**
 * End-to-end smoke test for the door kiosk (migrations 57-59).
 *
 * A device token is a second way into the API, so the thing worth proving is
 * not just "a device can call /kiosk/me" but that the two credentials cannot
 * be swapped: a session must not pass as a device, and a device must not pass
 * as a session. Those are the checks below that would be easiest to lose in a
 * refactor and hardest to notice.
 *
 * It creates a temporary ADMIN, EMPLOYEE and CLIENT through the service-role
 * admin API, and deletes all three - plus every device row it made and the
 * audit entries those rows produced - in a `finally`. Nothing it touches is a
 * real account, and it never prints a token or a password.
 *
 *   node scripts/smoke-kiosk.js --url https://beautyalleyibms.vercel.app
 *   node scripts/smoke-kiosk.js --url http://127.0.0.1:4000
 *
 * Exits non-zero on the first failed assertion.
 */

require("./_load-env");

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const args = process.argv.slice(2);
const urlIndex = args.indexOf("--url");
const BASE = (urlIndex >= 0 ? args[urlIndex + 1] : process.env.API_BASE_URL || "http://127.0.0.1:4000")
  .replace(/\/+$/, "");

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const suffix = crypto.randomBytes(4).toString("hex");
const ADMIN_EMAIL = `smoke-kiosk-admin-${suffix}@example.com`;
const EMPLOYEE_EMAIL = `smoke-kiosk-employee-${suffix}@example.com`;
const CLIENT_EMAIL = `smoke-kiosk-client-${suffix}@example.com`;
const PASSWORD = crypto.randomBytes(18).toString("base64url");

const TOKEN_SHAPE = /^kiosk\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/;

const userIds = [];
const deviceIds = [];
const employeeIds = [];
const bookingIds = [];
let failures = 0;
let cleanupFailures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * A cleanup step that reports rather than throws.
 *
 * A delete that fails here leaves furniture behind, and the *next* run then
 * fails for reasons that have nothing to do with the code - which is exactly
 * how a leftover `Smoke PIN Two` came to hold the PIN the collision check
 * wanted. So the error is counted and printed, not swallowed.
 */
async function cleanupStep(label, run) {
  try {
    const { error } = await run();
    if (error) throw new Error(error.message);
  } catch (err) {
    cleanupFailures++;
    console.error(`CLEANUP  ${label} — ${err.message}`);
  }
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json, code: json?.error?.code };
}

async function login(email, password) {
  const res = await api("/api/v1/auth/login", { method: "POST", body: { email, password } });
  return res.json?.data?.session?.accessToken ?? null;
}

async function makeUser(email, role, fullName) {
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { full_name: fullName },
  });
  if (created.error) throw new Error(`create ${role}: ${created.error.message}`);
  userIds.push(created.data.user.id);
  return created.data.user.id;
}

/** Wait for the fire-and-forget last-seen write to land. */
async function lastSeenOf(id, token, attempts = 15) {
  for (let i = 0; i < attempts; i++) {
    const res = await api("/api/v1/kiosk/devices", { token });
    const row = res.json?.data?.find((d) => d.id === id);
    if (row?.lastSeenAt) return row.lastSeenAt;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/**
 * A PIN that nobody at the salon currently holds.
 *
 * `pin_lookup` is globally unique, so a fixed literal such as "4821" is only
 * free until a real stylist picks it - and once one has, every run against the
 * pilot fails on the *first* set, then cascades into half a dozen assertions
 * that all look like product bugs. The probe employee is how a candidate is
 * tested: a 200 means the digits were free, and the row is deleted again at
 * once so the caller can hand them to whoever the check is about.
 */
async function freePin(probeId, token) {
  for (let i = 0; i < 40; i++) {
    const candidate = String(crypto.randomInt(100000, 1000000));

    const probe = await api(`/api/v1/employees/${probeId}/pin`, {
      method: "PUT",
      token,
      body: { pin: candidate },
    });
    if (probe.status !== 200) {
      if (probe.code === "PIN_TAKEN") continue; // someone holds these digits
      throw new Error(`probe PIN: ${probe.status} ${probe.code}`);
    }

    const released = await api(`/api/v1/employees/${probeId}/pin`, { method: "DELETE", token });
    if (released.status !== 200) {
      throw new Error(`release probe PIN: ${released.status} ${released.code}`);
    }
    return candidate;
  }
  throw new Error("no free PIN in 40 tries");
}

/**
 * A booking whose pass is open right now.
 *
 * Written straight to the table rather than through `POST /bookings`, because
 * the point of this section is the door, not the availability grid: a booking
 * made through the API has to land on a free slot inside today's working
 * hours, and at 23:00 Manila there is no such slot at all. The EXCLUDE
 * constraint is the oracle - a taken window comes back as 23P01 and the next
 * offset is tried - so this cannot collide with a real booking either.
 *
 * The offsets walk the arrival window because the pass only opens
 * `arrivalWindowMinutes` before the start and closes when the appointment ends.
 */
async function insertCheckinableBooking(employeeId, reference, service, windowMinutes) {
  const durationMs = 30 * 60_000;
  const step = 5 * 60_000;
  const windowMs = windowMinutes * 60_000;

  for (let offset = windowMs - step; offset >= -(durationMs - step); offset -= step) {
    const start = new Date(Date.now() + offset);
    const end = new Date(start.getTime() + durationMs);

    const inserted = await admin
      .from("bookings")
      .insert({
        reference,
        guest_name: "Smoke Door Guest",
        // The `bookings_identity` constraint wants a client or a name *and* a
        // phone. This fixture is a guest, so it supplies both.
        guest_phone: "+639009990001",
        employee_id: employeeId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status: "CONFIRMED",
        subtotal_cents: service.price_cents,
        discount_cents: 0,
        total_cents: service.price_cents,
      })
      .select("id")
      .single();

    if (inserted.error?.code === "23P01") continue; // that window is taken
    if (inserted.error) throw new Error(`create booking: ${inserted.error.message}`);

    const bookingId = inserted.data.id;
    const item = await admin.from("booking_items").insert({
      booking_id: bookingId,
      service_id: service.id,
      employee_id: employeeId,
      name_snapshot: service.name,
      price_cents_snapshot: service.price_cents,
      duration_minutes_snapshot: service.duration_minutes,
    });
    if (item.error) throw new Error(`create booking item: ${item.error.message}`);

    // `create_booking` normally writes the pass row; a direct insert has to do
    // it here, or `GET /bookings/:id/qr` has nothing to sign. Same expiry rule
    // as the function: the appointment's end plus a day.
    const token = await admin.from("qr_tokens").insert({
      booking_id: bookingId,
      expires_at: new Date(end.getTime() + 86_400_000).toISOString(),
    });
    if (token.error) throw new Error(`create pass: ${token.error.message}`);

    return bookingId;
  }

  throw new Error("no check-in-able slot was free for the fixture booking");
}

async function main() {
  // --- fixtures -------------------------------------------------------
  await makeUser(ADMIN_EMAIL, "ADMIN", "Smoke Kiosk Admin");
  await makeUser(EMPLOYEE_EMAIL, "EMPLOYEE", "Smoke Kiosk Stylist");
  await makeUser(CLIENT_EMAIL, "CLIENT", "Smoke Kiosk Client");

  const adminToken = await login(ADMIN_EMAIL, PASSWORD);
  const employeeToken = await login(EMPLOYEE_EMAIL, PASSWORD);
  const clientToken = await login(CLIENT_EMAIL, PASSWORD);
  check("temporary accounts can sign in", Boolean(adminToken && employeeToken && clientToken));

  // --- who may manage devices -----------------------------------------
  const anon = await api("/api/v1/kiosk/devices");
  check("GET /kiosk/devices without a token is 401", anon.status === 401, `got ${anon.status}`);

  const asClient = await api("/api/v1/kiosk/devices", { token: clientToken });
  check("a CLIENT cannot list devices", asClient.status === 403, `got ${asClient.status}`);

  const asEmployee = await api("/api/v1/kiosk/devices", { token: employeeToken });
  check("an EMPLOYEE cannot list devices", asEmployee.status === 403, `got ${asEmployee.status}`);

  const list = await api("/api/v1/kiosk/devices", { token: adminToken });
  check("GET /kiosk/devices is 200 for ADMIN", list.status === 200, `got ${list.status}`);
  check("the list is an array", Array.isArray(list.json?.data));

  // --- issuing ---------------------------------------------------------
  const blank = await api("/api/v1/kiosk/devices", {
    method: "POST",
    token: adminToken,
    body: { label: "   " },
  });
  check("a label of spaces is refused as empty", blank.status === 400, `got ${blank.status}`);

  const created = await api("/api/v1/kiosk/devices", {
    method: "POST",
    token: adminToken,
    body: { label: `Smoke door ${suffix}` },
  });
  check("POST /kiosk/devices is 201 for ADMIN", created.status === 201, `got ${created.status}`);

  const device = created.json?.data?.device;
  const deviceToken = created.json?.data?.token;
  if (device?.id) deviceIds.push(device.id);

  check("the response carries the device", Boolean(device?.id && device?.label));
  check("the response carries a token, once", TOKEN_SHAPE.test(deviceToken ?? ""), String(deviceToken));
  check("a new device starts unrevoked", device?.revokedAt === null);
  check(
    "the device is not reported as seen before it has called in",
    device?.lastSeenAt === null
  );

  // --- the device talks -----------------------------------------------
  const me = await api("/api/v1/kiosk/me", { token: deviceToken });
  check("GET /kiosk/me is 200 with a device token", me.status === 200, `got ${me.status}`);
  check("the device learns its own id and label", me.json?.data?.id === device?.id);
  check("the device is not given a token back", me.json?.data?.token === undefined);

  const seen = await lastSeenOf(device.id, adminToken);
  check("the device's last-seen stamp is written", Boolean(seen), String(seen));

  // --- the two credentials are not interchangeable ---------------------
  const sessionAsDevice = await api("/api/v1/kiosk/me", { token: adminToken });
  check(
    "a staff session is not a device token",
    sessionAsDevice.status === 401 && sessionAsDevice.code === "KIOSK_TOKEN_INVALID",
    `got ${sessionAsDevice.status} ${sessionAsDevice.code}`
  );

  const deviceAsSession = await api("/api/v1/kiosk/devices", { token: deviceToken });
  check(
    "a device token is not a session",
    deviceAsSession.status === 401,
    `got ${deviceAsSession.status} ${deviceAsSession.code}`
  );

  const unknown = await api(
    `/api/v1/kiosk/me`,
    { token: `kiosk.${crypto.randomUUID()}.${"a".repeat(43)}` }
  );
  check(
    "a well-formed token for an unknown device is 401",
    unknown.status === 401 && unknown.code === "KIOSK_TOKEN_INVALID",
    `got ${unknown.status} ${unknown.code}`
  );

  const [prefix, id, secret] = deviceToken.split(".");
  const flipped = secret.slice(0, -1) + (secret.endsWith("A") ? "B" : "A");
  const tampered = await api("/api/v1/kiosk/me", { token: `${prefix}.${id}.${flipped}` });
  check(
    "a tampered secret is 401",
    tampered.status === 401 && tampered.code === "KIOSK_TOKEN_INVALID",
    `got ${tampered.status} ${tampered.code}`
  );

  // --- revocation ------------------------------------------------------
  const revoke = await api(`/api/v1/kiosk/devices/${device.id}/revoke`, {
    method: "POST",
    token: adminToken,
  });
  check("POST /kiosk/devices/:id/revoke is 200 for ADMIN", revoke.status === 200, `got ${revoke.status}`);
  check("the device now carries a revokedAt", Boolean(revoke.json?.data?.revokedAt));

  const afterRevoke = await api("/api/v1/kiosk/me", { token: deviceToken });
  check(
    "a revoked device is refused, and told why",
    afterRevoke.status === 403 && afterRevoke.code === "KIOSK_REVOKED",
    `got ${afterRevoke.status} ${afterRevoke.code}`
  );

  const again = await api(`/api/v1/kiosk/devices/${device.id}/revoke`, {
    method: "POST",
    token: adminToken,
  });
  check(
    "revoking twice is 409, not a silent success",
    again.status === 409 && again.code === "KIOSK_ALREADY_REVOKED",
    `got ${again.status} ${again.code}`
  );

  const missing = await api(`/api/v1/kiosk/devices/${crypto.randomUUID()}/revoke`, {
    method: "POST",
    token: adminToken,
  });
  check(
    "revoking an unknown device is 404",
    missing.status === 404 && missing.code === "KIOSK_NOT_FOUND",
    `got ${missing.status} ${missing.code}`
  );

  const after = await api("/api/v1/kiosk/devices", { token: adminToken });
  const kept = after.json?.data?.find((d) => d.id === device.id);
  check("a revoked device stays in the list, so the record survives", Boolean(kept));
  check("its revokedAt is visible to the owner", Boolean(kept?.revokedAt));

  const keys = new Set(Object.keys(kept ?? {}));
  check(
    "the list carries no token, secret or digest field",
    !keys.has("token") && !keys.has("secret") && !keys.has("tokenHash") && !keys.has("token_hash"),
    [...keys].join(",")
  );

  // --- door PINs -------------------------------------------------------
  //
  // The fixtures are inactive on purpose: they never appear on the public
  // "meet the team" list, not even for the second this takes, and the PIN
  // endpoints do not care about is_active (a person can be given a PIN before
  // their first shift).
  //
  // `probe` exists only to test whether a PIN is free; it never keeps one.
  const pinHolders = [];
  for (const name of ["Smoke PIN One", "Smoke PIN Two", "Smoke PIN Probe"]) {
    const made = await admin
      .from("employees")
      .insert({ full_name: name, is_active: false })
      .select("id")
      .single();
    if (made.error) throw new Error(`create employee: ${made.error.message}`);
    employeeIds.push(made.data.id);
    pinHolders.push(made.data.id);
  }
  const [first, second, probe] = pinHolders;

  const noPin = await api(`/api/v1/employees/${first}/pin`, { token: adminToken });
  check("a new employee has no PIN", noPin.status === 200 && noPin.json?.data?.hasPin === false);
  check("the PIN read names the person", noPin.json?.data?.employeeId === first);

  const tooShort = await api(`/api/v1/employees/${first}/pin`, {
    method: "PUT",
    token: adminToken,
    body: { pin: "12" },
  });
  check("a two-digit PIN is refused", tooShort.status === 400, `got ${tooShort.status}`);

  const letters = await api(`/api/v1/employees/${first}/pin`, {
    method: "PUT",
    token: adminToken,
    body: { pin: "12a4" },
  });
  check("a PIN with letters is refused", letters.status === 400, `got ${letters.status}`);

  const tooLong = await api(`/api/v1/employees/${first}/pin`, {
    method: "PUT",
    token: adminToken,
    body: { pin: "1234567" },
  });
  check("a seven-digit PIN is refused", tooLong.status === 400, `got ${tooLong.status}`);

  const pinA = await freePin(probe, adminToken);
  const set = await api(`/api/v1/employees/${first}/pin`, {
    method: "PUT",
    token: adminToken,
    body: { pin: pinA },
  });
  check("PUT /employees/:id/pin is 200 for ADMIN", set.status === 200, `got ${set.status}`);
  check("the person now has a PIN", set.json?.data?.hasPin === true);
  check("the PIN is not echoed back", JSON.stringify(set.json ?? {}).indexOf(pinA) === -1);
  check(
    "the digest is not echoed back either",
    !Object.keys(set.json?.data ?? {}).some((k) => /lookup|digest|hash/i.test(k)),
    Object.keys(set.json?.data ?? {}).join(",")
  );

  const readBack = await api(`/api/v1/employees/${first}/pin`, { token: adminToken });
  check("the PIN survives a re-read", readBack.json?.data?.hasPin === true);

  const stored = await admin
    .from("staff_pins")
    .select("pin_lookup")
    .eq("employee_id", first)
    .maybeSingle();
  check(
    "the database holds a 64-hex digest, not the digits",
    /^[0-9a-f]{64}$/.test(stored.data?.pin_lookup ?? ""),
    String(stored.data?.pin_lookup).slice(0, 12)
  );
  check("the digest is not the PIN", stored.data?.pin_lookup !== pinA);

  const audit = await admin
    .from("audit_logs")
    .select("id, action")
    .eq("entity", "employees")
    .eq("entity_id", first)
    .eq("action", "staff.pin_set");
  check("setting a PIN is audited", (audit.data ?? []).length >= 1);

  const taken = await api(`/api/v1/employees/${second}/pin`, {
    method: "PUT",
    token: adminToken,
    body: { pin: pinA },
  });
  check(
    "two people cannot share a PIN",
    taken.status === 409 && taken.code === "PIN_TAKEN",
    `got ${taken.status} ${taken.code}`
  );

  const pinB = await freePin(probe, adminToken);
  const other = await api(`/api/v1/employees/${second}/pin`, {
    method: "PUT",
    token: adminToken,
    body: { pin: pinB },
  });
  check("a different PIN is accepted for the second person", other.status === 200);

  const pinC = await freePin(probe, adminToken);
  const changed = await api(`/api/v1/employees/${first}/pin`, {
    method: "PUT",
    token: adminToken,
    body: { pin: pinC },
  });
  check("a PIN can be replaced", changed.status === 200 && changed.json?.data?.hasPin === true);

  const reused = await api(`/api/v1/employees/${second}/pin`, {
    method: "PUT",
    token: adminToken,
    body: { pin: pinA },
  });
  check("the replaced PIN is free for someone else to use", reused.status === 200, `got ${reused.status}`);

  const asStylist = await api(`/api/v1/employees/${first}/pin`, { token: employeeToken });
  check("an EMPLOYEE cannot read a door PIN", asStylist.status === 403, `got ${asStylist.status}`);

  const unknownEmployee = await api(`/api/v1/employees/${crypto.randomUUID()}/pin`, {
    token: adminToken,
  });
  check(
    "an unknown employee is 404",
    unknownEmployee.status === 404 && unknownEmployee.code === "EMPLOYEE_NOT_FOUND",
    `got ${unknownEmployee.status} ${unknownEmployee.code}`
  );

  const cleared = await api(`/api/v1/employees/${first}/pin`, {
    method: "DELETE",
    token: adminToken,
  });
  check("DELETE /employees/:id/pin is 200", cleared.status === 200 && cleared.json?.data?.hasPin === false);

  const clearedAgain = await api(`/api/v1/employees/${first}/pin`, {
    method: "DELETE",
    token: adminToken,
  });
  check(
    "clearing twice is a success, not a 404",
    clearedAgain.status === 200 && clearedAgain.json?.data?.hasPin === false,
    `got ${clearedAgain.status}`
  );

  // --- the door admits a guest -----------------------------------------
  //
  // A second, live device: the one above was revoked on purpose, and a revoked
  // screen must not get this far.
  const door = await api("/api/v1/kiosk/devices", {
    method: "POST",
    token: adminToken,
    body: { label: `Smoke door live ${suffix}` },
  });
  const doorToken = door.json?.data?.token;
  if (door.json?.data?.device?.id) deviceIds.push(door.json.data.device.id);
  check("a second screen can be provisioned", door.status === 201 && Boolean(doorToken));

  const service = await admin
    .from("services")
    .select("id, name, price_cents, duration_minutes")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (service.error) throw new Error(`pick a service: ${service.error.message}`);

  const bookingId = await insertCheckinableBooking(
    second,
    `BA-SMOKE-${suffix}`,
    service.data,
    60
  );
  bookingIds.push(bookingId);

  const passRes = await api(`/api/v1/bookings/${bookingId}/qr`, { token: adminToken });
  const pass = passRes.json?.data?.pass;
  check("the fixture booking has a pass", passRes.status === 200 && Boolean(pass), String(passRes.status));

  const noToken = await api("/api/v1/kiosk/lookup", { method: "POST", body: { pass } });
  check("the door needs a device token", noToken.status === 401, `got ${noToken.status}`);

  const junk = await api("/api/v1/kiosk/lookup", {
    method: "POST",
    token: doorToken,
    body: { pass: "BA1.not-a-real-pass.value" },
  });
  check(
    "a junk pass is refused as invalid",
    junk.status === 400 && junk.code === "QR_INVALID",
    `got ${junk.status} ${junk.code}`
  );

  const look = await api("/api/v1/kiosk/lookup", {
    method: "POST",
    token: doorToken,
    body: { pass },
  });
  check("POST /kiosk/lookup is 200 for a live pass", look.status === 200, `got ${look.status}`);
  check("the door learns who the guest is", look.json?.data?.guestName === "Smoke Door Guest");
  check("it names the stylist they are seeing", look.json?.data?.staffName === "Smoke PIN Two");
  check(
    "it names what they booked",
    Array.isArray(look.json?.data?.services) && look.json.data.services[0] === service.data.name,
    JSON.stringify(look.json?.data?.services)
  );
  check("the arrival is inside its window", look.json?.data?.window === "OPEN");
  check("nothing blocks admission", look.json?.data?.blocked === null, String(look.json?.data?.blocked));
  check(
    "the lookup carries no contact details",
    !("guestPhone" in (look.json?.data ?? {})) && !("clientId" in (look.json?.data ?? {}))
  );

  // A PIN that belongs to nobody, so "wrong PIN" cannot accidentally be
  // somebody else's *right* PIN - which would admit the guest and turn the next
  // three assertions into nonsense.
  const pinWrong = await freePin(probe, adminToken);

  const wrongPin = await api("/api/v1/kiosk/check-in", {
    method: "POST",
    token: doorToken,
    body: { pass, pin: pinWrong },
  });
  check(
    "a wrong PIN is refused, with the attempts left",
    wrongPin.status === 401 &&
      wrongPin.code === "KIOSK_PIN_INVALID" &&
      wrongPin.json?.error?.details?.attemptsLeft === 4,
    `got ${wrongPin.status} ${wrongPin.code} ${JSON.stringify(wrongPin.json?.error?.details)}`
  );

  // `second` must be deactivated *here*, not merely created that way: the check
  // is about the verdict for a live PIN held by someone who is not working
  // today, so the state it depends on is set immediately before it is read.
  const deactivated = await admin.from("employees").update({ is_active: false }).eq("id", second);
  if (deactivated.error) throw new Error(`deactivate: ${deactivated.error.message}`);

  const inactive = await api("/api/v1/kiosk/check-in", {
    method: "POST",
    token: doorToken,
    body: { pass, pin: pinA },
  });
  check(
    "a correct PIN for a deactivated stylist is not reported as wrong",
    inactive.status === 403 && inactive.code === "KIOSK_PIN_INACTIVE",
    `got ${inactive.status} ${inactive.code}`
  );

  const activated = await admin.from("employees").update({ is_active: true }).eq("id", second);
  if (activated.error) throw new Error(`activate: ${activated.error.message}`);

  const admitted = await api("/api/v1/kiosk/check-in", {
    method: "POST",
    token: doorToken,
    body: { pass, pin: pinA },
  });
  check("POST /kiosk/check-in is 200", admitted.status === 200, `got ${admitted.status} ${admitted.code}`);
  check("the guest is checked in", admitted.json?.data?.status === "CHECKED_IN");
  check("the response names the stylist who admitted them", admitted.json?.data?.staffName === "Smoke PIN Two");
  check("the response does not name a device to the guest", !("kioskId" in (admitted.json?.data ?? {})));

  const checkin = await admin
    .from("checkins")
    .select("staff_id, kiosk_id")
    .eq("booking_id", bookingId)
    .maybeSingle();
  check("the check-in records the stylist", checkin.data?.staff_id === second);
  check("the check-in records the screen that admitted them", checkin.data?.kiosk_id === door.json?.data?.device?.id);

  const bookingAfter = await admin.from("bookings").select("status").eq("id", bookingId).maybeSingle();
  check("the booking moved to CHECKED_IN", bookingAfter.data?.status === "CHECKED_IN");

  const replay = await api("/api/v1/kiosk/check-in", {
    method: "POST",
    token: doorToken,
    body: { pass, pin: pinA },
  });
  check(
    "the same pass cannot admit a second guest",
    replay.status === 409 && replay.code === "ALREADY_CHECKED_IN",
    `got ${replay.status} ${replay.code}`
  );

  // --- the throttle -----------------------------------------------------
  //
  // Five wrong PINs arm the lock on the fifth and refuse on the sixth. That is
  // the deliberate shape: the fifth failure is still reported as a failure, and
  // the wait is announced when it actually bites.
  const attemptsLeft = [];
  for (let i = 0; i < 5; i++) {
    const miss = await api("/api/v1/kiosk/check-in", {
      method: "POST",
      token: doorToken,
      body: { pass, pin: pinWrong },
    });
    attemptsLeft.push(miss.json?.error?.details?.attemptsLeft);
  }
  check(
    "the attempts count down 4, 3, 2, 1, 0",
    attemptsLeft.join(",") === "4,3,2,1,0",
    attemptsLeft.join(",")
  );

  const locked = await api("/api/v1/kiosk/check-in", {
    method: "POST",
    token: doorToken,
    body: { pass, pin: pinA },
  });
  check(
    "the screen is locked out, and told for how long",
    locked.status === 429 &&
      locked.code === "KIOSK_PIN_LOCKED" &&
      locked.json?.error?.details?.retryAfterSeconds > 0,
    `got ${locked.status} ${locked.code} ${JSON.stringify(locked.json?.error?.details)}`
  );
  check(
    "the lock outlasts a correct PIN - the point of the throttle",
    locked.json?.error?.details?.retryAfterSeconds > 30,
    String(locked.json?.error?.details?.retryAfterSeconds)
  );
}

main()
  .catch((err) => {
    failures++;
    console.error(`ERROR  ${err.message}`);
  })
  .finally(async () => {
    // Always clean up, even if an assertion failed half-way through. The order
    // is not cosmetic: `bookings.employee_id` references the fixture employees,
    // so deleting them first fails - and when that error was swallowed, the
    // person and their PIN survived to poison the next run. The booking goes
    // first and takes its items, pass and check-in with it.
    //
    // Devices are deleted outright rather than revoked: a smoke run on the
    // pilot should leave no furniture behind.
    if (bookingIds.length > 0) {
      await cleanupStep("booking audit rows", () =>
        admin.from("audit_logs").delete().eq("entity", "bookings").in("entity_id", bookingIds)
      );
      await cleanupStep("fixture bookings", () =>
        admin.from("bookings").delete().in("id", bookingIds)
      );
    }

    if (employeeIds.length > 0) {
      await cleanupStep("employee audit rows", () =>
        admin.from("audit_logs").delete().eq("entity", "employees").in("entity_id", employeeIds)
      );
      // Their PINs go with them (`on delete cascade`), so only the audit rows
      // need clearing by hand.
      await cleanupStep("fixture employees", () =>
        admin.from("employees").delete().in("id", employeeIds)
      );
    }

    if (deviceIds.length > 0) {
      await cleanupStep("device audit rows", () =>
        admin.from("audit_logs").delete().eq("entity", "kiosk_devices").in("entity_id", deviceIds)
      );
      await cleanupStep("fixture devices", () =>
        admin.from("kiosk_devices").delete().in("id", deviceIds)
      );
    }

    for (const id of userIds) {
      await admin.auth.admin.deleteUser(id).catch(() => undefined);
    }

    const ok = failures === 0 && cleanupFailures === 0;
    console.log(
      ok
        ? "\nALL CHECKS PASSED"
        : `\n${failures} CHECK(S) FAILED${
            cleanupFailures > 0 ? `, ${cleanupFailures} CLEANUP PROBLEM(S)` : ""
          }`
    );
    process.exit(ok ? 0 : 1);
  });
