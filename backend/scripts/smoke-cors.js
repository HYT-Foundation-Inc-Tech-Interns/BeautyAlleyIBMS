#!/usr/bin/env node
"use strict";

/**
 * CORS smoke probe.
 *
 * The production guard in `config/env.ts` exists because a public API must not
 * reflect an arbitrary origin while allowing credentials. That guard is only
 * worth anything if someone checks the deployed host actually boots with
 * `NODE_ENV=production` - the 30 October audit found a live deployment running
 * as `development`, where the guard never runs.
 *
 * This probe answers one question: does the API echo back an origin it was
 * never configured to trust?
 *
 *   node scripts/smoke-cors.js --url https://beautyalleyibms.vercel.app
 *   node scripts/smoke-cors.js --url http://127.0.0.1:4000 --expect-production
 *
 * Exit 0 = safe, 1 = unsafe or unreachable. It is safe to run against local
 * development, but `--expect-production` will then fail by design.
 */

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  return args[i + 1] ?? fallback;
}

const baseUrl = (argValue("--url", process.env.API_BASE_URL || "http://127.0.0.1:4000")).replace(
  /\/+$/,
  "",
);
const expectProduction = args.includes("--expect-production");
const hostileOrigin = "https://evil.example.com";
const probePath = "/api/v1/services?limit=1";

const problems = [];
const notes = [];

async function main() {
  let health;
  try {
    const res = await fetch(`${baseUrl}/health`, { headers: { accept: "application/json" } });
    health = await res.json();
  } catch (err) {
    console.error(`UNREACHABLE  ${baseUrl}/health — ${err.message}`);
    process.exit(1);
  }

  const reportedEnv = health?.env ?? "(missing)";
  console.log(`health.env   ${reportedEnv}`);
  if (expectProduction && reportedEnv !== "production") {
    problems.push(
      `health reports env="${reportedEnv}", expected "production". The production guard is not running.`,
    );
  }

  // A preflight is what a browser sends before a credentialed cross-origin
  // request. If this reflects the hostile origin, the hole is real.
  let preflight;
  try {
    preflight = await fetch(`${baseUrl}${probePath}`, {
      method: "OPTIONS",
      headers: {
        origin: hostileOrigin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization,content-type",
      },
    });
  } catch (err) {
    console.error(`UNREACHABLE  preflight — ${err.message}`);
    process.exit(1);
  }

  const allowOrigin = preflight.headers.get("access-control-allow-origin");
  const allowCreds = preflight.headers.get("access-control-allow-credentials");

  console.log(`preflight    ${preflight.status}`);
  console.log(`ACAO         ${allowOrigin ?? "(absent)"}`);
  console.log(`ACAC         ${allowCreds ?? "(absent)"}`);

  if (allowOrigin === hostileOrigin) {
    problems.push(
      `preflight reflects the hostile origin (${hostileOrigin})` +
        (allowCreds === "true" ? " WITH credentials allowed." : "."),
    );
  }
  if (allowOrigin === "*") {
    notes.push("preflight returns a wildcard origin; acceptable only without credentials.");
  }

  // A plain GET is the shape most clients actually make. Check it too: some
  // proxies answer preflight correctly and then reflect on the real request.
  let get;
  try {
    get = await fetch(`${baseUrl}${probePath}`, {
      headers: { origin: hostileOrigin, accept: "application/json" },
    });
  } catch (err) {
    console.error(`UNREACHABLE  GET — ${err.message}`);
    process.exit(1);
  }
  const getAllowOrigin = get.headers.get("access-control-allow-origin");
  console.log(`GET ACAO     ${getAllowOrigin ?? "(absent)"}`);
  if (getAllowOrigin === hostileOrigin) {
    problems.push(`GET reflects the hostile origin (${hostileOrigin}).`);
  }

  for (const note of notes) console.log(`note         ${note}`);

  if (problems.length) {
    console.error("\nFAIL");
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nFix: set NODE_ENV=production and ALLOWED_ORIGINS to the exact deployed origins,\n" +
        "then redeploy. See docs/runbook.md.",
    );
    process.exit(1);
  }

  console.log("\nPASS  no unconfigured origin was reflected.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
