#!/usr/bin/env node
/**
 * Send due booking reminders.
 *
 * Run on a schedule — every 5–15 minutes is plenty — or by hand:
 *
 *   npm run reminders:dry     # show what is due, change nothing
 *   npm run reminders         # send, mark SENT/FAILED/SKIPPED
 *
 * The queue is filled by the `bookings_sync_reminders` trigger, so this script
 * never decides *whether* a reminder is due; it only sends what the database
 * says is due. That keeps a reschedule or a cancellation from being missed.
 *
 * Without SMTP configured the script exits 0 and leaves the rows PENDING: the
 * queue is a to-do list, not a failure. Configure SMTP_HOST/SMTP_FROM (and
 * usually SMTP_USER/SMTP_PASS) and run it again.
 */

const { Client } = require("pg");
const nodemailer = require("nodemailer");
require("./_load-env");

const smtpHost = process.env.SMTP_HOST || "";
const smtpFrom = process.env.SMTP_FROM || "Beauty Alley <no-reply@beautyalley.app>";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1";
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const timezone = process.env.BRANCH_TIMEZONE || "Asia/Manila";
const windowHours = Number(process.env.CANCELLATION_WINDOW_HOURS || 2);
const smtpConfigured = Boolean(smtpHost && smtpFrom && (!smtpUser || smtpPass));

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

const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 50) : 50;

const whenFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: timezone,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
});

const DUE_SQL = `
  select r.id,
         r.kind,
         r.send_at,
         b.reference,
         b.start_time,
         b.guest_name,
         c.full_name              as client_name,
         c.email                  as client_email,
         e.full_name              as employee_name
    from public.reminder_outbox r
    join public.bookings b on b.id = r.booking_id
    left join public.clients c on c.id = b.client_id
    left join public.employees e on e.id = b.employee_id
   where r.status = 'PENDING'
     and r.send_at <= now()
   order by r.send_at
   limit $1
`;

function body(row) {
  const name = row.client_name || row.guest_name || "there";
  const when = whenFmt.format(new Date(row.start_time));
  const who = row.employee_name ? ` with ${row.employee_name}` : "";
  return [
    `Hello ${name},`,
    "",
    `A reminder that your appointment at Beauty Alley is ${when}${who}.`,
    `Reference: ${row.reference}`,
    "",
    "Please arrive a few minutes early and have your arrival pass ready.",
    `If you need to move or cancel, open My bookings. Cancelling is free up to ${windowHours} hours before the appointment.`,
    "",
    "— Beauty Alley",
  ].join("\n");
}

(async () => {
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  try {
    const { rows } = await db.query(DUE_SQL, [limit]);

    if (rows.length === 0) {
      console.log("No reminders are due.");
      return;
    }

    if (!smtpConfigured) {
      console.log(`${rows.length} reminder(s) due, but SMTP is not configured. Left PENDING.`);
      for (const row of rows) console.log(`  ${row.reference}  ${row.kind}  ${row.client_email || "(no email)"}`);
      return;
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      const to = row.client_email;
      if (!to) {
        if (!dryRun) {
          await db.query(
            `update public.reminder_outbox
                set status = 'SKIPPED', last_error = 'no email on file'
              where id = $1`,
            [row.id],
          );
        }
        skipped++;
        console.log(`SKIP  ${row.reference} ${row.kind} — no email`);
        continue;
      }

      if (dryRun) {
        console.log(`DRY   ${row.reference} ${row.kind} -> ${to}`);
        continue;
      }

      await db.query(
        `update public.reminder_outbox
            set status = 'SENDING', attempts = attempts + 1
          where id = $1 and status = 'PENDING'`,
        [row.id],
      );

      try {
        await mailer().sendMail({
          from: smtpFrom,
          to,
          subject: `Reminder: ${row.reference} on ${whenFmt.format(new Date(row.start_time))}`,
          text: body(row),
        });
        await db.query(
          `update public.reminder_outbox
              set status = 'SENT', sent_at = now(), last_error = null
            where id = $1`,
          [row.id],
        );
        sent++;
        console.log(`SENT  ${row.reference} ${row.kind} -> ${to}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.query(
          `update public.reminder_outbox
              set status = 'FAILED', last_error = $2
            where id = $1`,
          [row.id, message.slice(0, 500)],
        );
        failed++;
        console.log(`FAIL  ${row.reference} ${row.kind} — ${message}`);
      }
    }

    console.log(`\n${dryRun ? "Dry run" : "Done"}: ${sent} sent, ${failed} failed, ${skipped} skipped.`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
