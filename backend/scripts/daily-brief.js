#!/usr/bin/env node
/**
 * The owner's morning brief.
 *
 *   npm run brief                 # send yesterday's brief
 *   npm run brief:dry             # print it, claim nothing, send nothing
 *   node scripts/daily-brief.js --date=2026-11-10
 *   node scripts/daily-brief.js --to=owner@example.com
 *   node scripts/daily-brief.js --force      # send even if it already went out
 *
 * Scheduled by `.github/workflows/daily-brief.yml` at 23:00 UTC, which is
 * 07:00 in Manila. "Yesterday" is therefore the day that just ended in the
 * branch's timezone, not in the runner's.
 *
 * ## Why it claims before it sends
 *
 * The workflow can be re-run by hand and GitHub can deliver a schedule twice.
 * The brief must not. `claim_daily_brief` takes the day's row before the mail
 * is composed, and `finish_daily_brief` stamps it after; a failed send releases
 * the claim so the next run can try again. Claiming after sending would leave a
 * window where two runs both believe they are first.
 *
 * ## What it does when it cannot send
 *
 * Missing SMTP or DATABASE_URL exits 0 and says so. A fork without the salon's
 * secrets is not a broken build, and a scheduled job that goes red every
 * morning for a configuration it cannot fix trains people to ignore it.
 */

const { Client } = require("pg");
const nodemailer = require("nodemailer");
require("./_load-env");

const briefFormat = require("./brief-format");

const timezone = process.env.BRANCH_TIMEZONE || "Asia/Manila";
const salonName = process.env.SALON_NAME || "The Beauty Alley";

const smtpHost = process.env.SMTP_HOST || "";
const smtpFrom = process.env.SMTP_FROM || "Beauty Alley <no-reply@beautyalley.app>";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1";
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const smtpConfigured = Boolean(smtpHost && smtpFrom && (!smtpUser || smtpPass));

const targetCents = Number(process.env.DAILY_REVENUE_TARGET_CENTS || 0) || null;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const force = argv.includes("--force");
const dateArg = argv.find((a) => a.startsWith("--date="));
const toArg = argv.find((a) => a.startsWith("--to="));

let transporter = null;
function mailer() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      ...(smtpUser ? { auth: { user: smtpUser, pass: smtpPass } } : {}),
    });
  }
  return transporter;
}

/** The branch's calendar date, as YYYY-MM-DD. */
function branchToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Calendar arithmetic on a date string, with no timezone in the way. */
function shiftDate(dateStr, days) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function recipients() {
  if (toArg) {
    return toArg
      .slice("--to=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const configured = (process.env.BRIEF_RECIPIENTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;

  // SMTP_FROM is usually "The Beauty Alley <owner@…>"; the address is the
  // sensible default recipient, and it means one setting configures both ends.
  const match = smtpFrom.match(/<([^>]+)>/);
  const address = (match ? match[1] : smtpFrom).trim();
  return address ? [address] : [];
}

(async () => {
  const date = dateArg ? dateArg.slice("--date=".length) : shiftDate(branchToday(), -1);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`Not a date: ${date}`);
    process.exitCode = 1;
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[brief] DATABASE_URL is not set - nothing to read.");
    return;
  }

  const to = recipients();
  if (to.length === 0) {
    console.warn("[brief] No recipient. Set BRIEF_RECIPIENTS or SMTP_FROM.");
    return;
  }

  if (!smtpConfigured && !dryRun) {
    console.warn("[brief] SMTP is not configured - the brief was not sent.");
    return;
  }

  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  let claimed = false;

  try {
    const { rows } = await db.query("select public.get_daily_brief($1::date) as brief", [date]);
    const brief = rows[0].brief;

    const subject = briefFormat.subjectFor(brief);
    const text = briefFormat.textBody(brief, { targetCents, salonName });
    const html = briefFormat.htmlBody(brief, { targetCents, salonName });

    if (dryRun) {
      console.log(`DRY   ${subject} -> ${to.join(", ")}\n`);
      console.log(text);
      return;
    }

    if (!force) {
      const claim = await db.query("select public.claim_daily_brief($1::date) as claimed", [date]);
      claimed = claim.rows[0].claimed === true;
      if (!claimed) {
        console.log(`The brief for ${date} has already gone out.`);
        return;
      }
    }

    try {
      await mailer().sendMail({ from: smtpFrom, to: to.join(", "), subject, text, html });
    } catch (err) {
      // The mail did not leave, so the day is still free for the next run.
      await db.query("select public.release_daily_brief($1::date)", [date]);
      claimed = false;
      throw err;
    }

    await db.query("select public.finish_daily_brief($1::date, $2, $3::jsonb)", [
      date,
      to.join(", "),
      JSON.stringify(brief),
    ]);

    console.log(`SENT  ${subject} -> ${to.join(", ")}`);
  } catch (err) {
    if (claimed) {
      await db.query("select public.release_daily_brief($1::date)", [date]).catch(() => undefined);
    }
    console.error(`[brief] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
