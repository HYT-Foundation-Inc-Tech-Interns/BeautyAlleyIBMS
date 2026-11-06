#!/usr/bin/env node
"use strict";

/**
 * Rotates the password of the four demo accounts in one pass.
 *
 * The old password lived in `accounts.json`, a tracked file, for long enough
 * that it is in git history. Deleting the file field is not a rotation: the
 * password itself has to change at the identity provider, or the leak remains
 * usable.
 *
 * This script does the four `updateUserById` calls so nobody has to click
 * through the dashboard four times, and it never prints the password it sets.
 *
 *   ACCOUNT_PASSWORD='…' npm run rotate:demo-password
 *
 * The new password should also go into your password manager and into
 * `backend/.env.local` as ACCOUNT_PASSWORD, which is what the verify scripts
 * read. It must NOT go back into accounts.json.
 */

require("./_load-env");

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const MIN_LENGTH = 12;

async function main() {
  const password = process.env.ACCOUNT_PASSWORD;
  if (!password) {
    throw new Error(
      "Set ACCOUNT_PASSWORD to the new password, e.g.\n" +
        "  ACCOUNT_PASSWORD='…' npm run rotate:demo-password"
    );
  }
  if (password.length < MIN_LENGTH) {
    throw new Error(`ACCOUNT_PASSWORD must be at least ${MIN_LENGTH} characters.`);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env.local.");
  }

  const accountsFile = path.resolve(__dirname, "..", "..", "accounts.json");
  const accounts = JSON.parse(fs.readFileSync(accountsFile, "utf8")).accounts ?? [];

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // One page is enough for a salon; 1000 is the API maximum.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Could not list users: ${error.message}`);

  const byEmail = new Map((data.users ?? []).map((u) => [u.email?.toLowerCase(), u]));

  let updated = 0;
  const missing = [];

  for (const account of accounts) {
    const user = byEmail.get(account.email.toLowerCase());
    if (!user) {
      missing.push(account.email);
      continue;
    }
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password });
    if (updateError) {
      console.error(`FAILED   ${account.role.padEnd(9)} ${account.email} — ${updateError.message}`);
      continue;
    }
    console.log(`UPDATED  ${account.role.padEnd(9)} ${account.email}`);
    updated++;
  }

  console.log(`\n${updated} of ${accounts.length} demo accounts updated.`);
  if (missing.length) {
    console.warn(`Not found in Auth (nothing to update): ${missing.join(", ")}`);
  }
  console.log(
    "Next: put the same value in backend/.env.local as ACCOUNT_PASSWORD, and in your\n" +
      "password manager. Do not put it back into accounts.json."
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
