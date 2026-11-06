#!/usr/bin/env node
"use strict";

/**
 * End-to-end smoke test for the Settings release.
 *
 * It creates a temporary ADMIN and a temporary CLIENT through the service-role
 * admin API, exercises the password and payment endpoints over HTTP, and
 * deletes both accounts in a `finally`. Nothing it touches is a real account,
 * and it never prints a token or a password.
 *
 *   node scripts/smoke-settings.js --url https://beautyalleyibms.vercel.app
 *   node scripts/smoke-settings.js --url http://127.0.0.1:4000
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
const ADMIN_EMAIL = `smoke-admin-${suffix}@example.com`;
const CLIENT_EMAIL = `smoke-client-${suffix}@example.com`;
const PASSWORD = crypto.randomBytes(18).toString("base64url");

let adminId = null;
let clientId = null;
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
  return { status: res.status, json };
}

async function login(email, password) {
  const res = await api("/api/v1/auth/login", { method: "POST", body: { email, password } });
  return res.json?.data?.session?.accessToken ?? null;
}

async function main() {
  // --- fixtures -------------------------------------------------------
  const adminUser = await admin.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { role: "ADMIN" },
    user_metadata: { full_name: "Smoke Admin" },
  });
  if (adminUser.error) throw new Error(`create admin: ${adminUser.error.message}`);
  adminId = adminUser.data.user.id;

  const clientUser = await admin.auth.admin.createUser({
    email: CLIENT_EMAIL,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { role: "CLIENT" },
    user_metadata: { full_name: "Smoke Client" },
  });
  if (clientUser.error) throw new Error(`create client: ${clientUser.error.message}`);
  clientId = clientUser.data.user.id;

  const adminToken = await login(ADMIN_EMAIL, PASSWORD);
  const clientToken = await login(CLIENT_EMAIL, PASSWORD);
  check("temporary accounts can sign in", Boolean(adminToken) && Boolean(clientToken));

  // --- payments -------------------------------------------------------
  const before = await api("/api/v1/settings/payments", { token: adminToken });
  check("GET /settings/payments is 200 for ADMIN", before.status === 200, `got ${before.status}`);
  const original = before.json?.data;
  check(
    "all five providers are present and the default is enabled",
    original?.options?.length === 5 &&
      original.options.every((o) => typeof o.enabled === "boolean") &&
      original.options.some((o) => o.id === original.default && o.enabled),
  );

  const toggled = original.options.map((o) => ({
    id: o.id,
    enabled: o.id === "bank_transfer" ? false : o.enabled,
  }));
  const put = await api("/api/v1/settings/payments", {
    method: "PUT",
    token: adminToken,
    body: { default: original.default, options: toggled },
  });
  check("PUT /settings/payments is 200 for ADMIN", put.status === 200, `got ${put.status}`);

  const after = await api("/api/v1/settings/payments", { token: adminToken });
  const bank = after.json?.data?.options?.find((o) => o.id === "bank_transfer");
  check("the change persisted", bank?.enabled === false);

  // Put it back so the smoke test leaves no trace in configuration.
  await api("/api/v1/settings/payments", {
    method: "PUT",
    token: adminToken,
    body: {
      default: original.default,
      options: original.options.map((o) => ({ id: o.id, enabled: o.enabled })),
    },
  });

  const forbidden = await api("/api/v1/settings/payments", { token: clientToken });
  check("a CLIENT cannot read payment settings", forbidden.status === 403, `got ${forbidden.status}`);

  // --- booking rules --------------------------------------------------
  const rulesBefore = await api("/api/v1/settings/booking", { token: adminToken });
  check("GET /settings/booking is 200 for ADMIN", rulesBefore.status === 200, `got ${rulesBefore.status}`);
  const rules = rulesBefore.json?.data;
  check(
    "the booking rules have both policies",
    typeof rules?.cancellationWindowHours === "number" &&
      typeof rules?.arrivalWindowMinutes === "number",
  );

  const rulesPut = await api("/api/v1/settings/booking", {
    method: "PUT",
    token: adminToken,
    body: { cancellationWindowHours: 3, arrivalWindowMinutes: 45 },
  });
  check("PUT /settings/booking is 200 for ADMIN", rulesPut.status === 200, `got ${rulesPut.status}`);

  const rulesAfter = await api("/api/v1/settings/booking", { token: adminToken });
  check(
    "the booking rule change persisted",
    rulesAfter.json?.data?.cancellationWindowHours === 3 &&
      rulesAfter.json?.data?.arrivalWindowMinutes === 45,
  );

  // Put the original policy back.
  await api("/api/v1/settings/booking", {
    method: "PUT",
    token: adminToken,
    body: {
      cancellationWindowHours: rules.cancellationWindowHours,
      arrivalWindowMinutes: rules.arrivalWindowMinutes,
    },
  });

  const rulesForbidden = await api("/api/v1/settings/booking", { token: clientToken });
  check("a CLIENT cannot read booking rules", rulesForbidden.status === 403, `got ${rulesForbidden.status}`);

  // --- passwords ------------------------------------------------------
  const wrong = await api("/api/v1/auth/password", {
    method: "POST",
    token: adminToken,
    body: { currentPassword: "definitely-not-it", newPassword: "a-different-password" },
  });
  check("changing a password with the wrong current one is 400", wrong.status === 400, `got ${wrong.status}`);

  const missing = await api("/api/v1/admin/users/password", {
    method: "POST",
    token: adminToken,
    body: { email: `nobody-${suffix}@example.com`, newPassword: "a-different-password" },
  });
  check("resetting an unknown email is 404", missing.status === 404, `got ${missing.status}`);

  const clientReset = await api("/api/v1/admin/users/password", {
    method: "POST",
    token: clientToken,
    body: { email: ADMIN_EMAIL, newPassword: "a-different-password" },
  });
  check("a CLIENT cannot reset another account", clientReset.status === 403, `got ${clientReset.status}`);

  const selfChange = await api("/api/v1/auth/password", {
    method: "POST",
    token: clientToken,
    body: { currentPassword: PASSWORD, newPassword: `${PASSWORD}-new` },
  });
  check("a user can change their own password with the current one", selfChange.status === 200, `got ${selfChange.status}`);

  const relogin = await login(CLIENT_EMAIL, `${PASSWORD}-new`);
  check("the new password works", Boolean(relogin));
}

main()
  .catch((err) => {
    failures++;
    console.error(`ERROR  ${err.message}`);
  })
  .finally(async () => {
    // Always clean up, even if an assertion failed half-way through.
    if (clientId) await admin.auth.admin.deleteUser(clientId).catch(() => undefined);
    if (adminId) await admin.auth.admin.deleteUser(adminId).catch(() => undefined);

    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
