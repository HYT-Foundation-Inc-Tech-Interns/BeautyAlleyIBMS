#!/usr/bin/env node
"use strict";

/**
 * End-to-end smoke test for the door kiosk (migration 57).
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
let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
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
}

main()
  .catch((err) => {
    failures++;
    console.error(`ERROR  ${err.message}`);
  })
  .finally(async () => {
    // Always clean up, even if an assertion failed half-way through. The
    // devices are deleted outright rather than revoked: a smoke run on the
    // pilot should leave no furniture behind.
    //
    // Wrapped in try/catch rather than `.catch()` on the builder: the
    // supabase-js filter builder is thenable but has no `catch` of its own, and
    // a cleanup that throws in `finally` masks the assertion that failed.
    if (deviceIds.length > 0) {
      try {
        await admin
          .from("audit_logs")
          .delete()
          .eq("entity", "kiosk_devices")
          .in("entity_id", deviceIds);
      } catch {
        /* the audit trail is append-only by intent; a leftover row is harmless */
      }
      try {
        await admin.from("kiosk_devices").delete().in("id", deviceIds);
      } catch {
        /* reported below as a non-zero exit only if an assertion already failed */
      }
    }
    for (const id of userIds) {
      await admin.auth.admin.deleteUser(id).catch(() => undefined);
    }

    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
