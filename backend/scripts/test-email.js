#!/usr/bin/env node
/**
 * Send one test email through the configured SMTP account.
 *
 *   npm run mail:test
 *
 * It goes to SMTP_USER unless an address is passed as the first argument. This
 * is the fastest way to tell a wrong app password from a wrong host: Gmail
 * answers 535 for the former and a connection error for the latter.
 */

const nodemailer = require("nodemailer");
require("./_load-env");

const host = process.env.SMTP_HOST || "";
const port = Number(process.env.SMTP_PORT || 587);
const secure = process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1";
const user = process.env.SMTP_USER || "";
const pass = process.env.SMTP_PASS || "";
const from = process.env.SMTP_FROM || user;
const to = process.argv[2] || user;

(async () => {
  if (!host || !from || !to) {
    console.log("SMTP is not configured. Set SMTP_HOST, SMTP_FROM and SMTP_USER.");
    process.exitCode = 1;
    return;
  }
  if (user && !pass) {
    console.log("SMTP_PASS is empty. Add the app password to backend/.env.local first.");
    process.exitCode = 1;
    return;
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user ? { auth: { user, pass } } : {}),
  });

  try {
    const info = await transport.sendMail({
      from,
      to,
      subject: "Beauty Alley SMTP test",
      text: "If you are reading this, booking reminders can send through this account.",
    });
    console.log(`Sent to ${to} (${info.messageId}).`);
  } catch (err) {
    console.error(`Failed: ${err.response || err.message}`);
    process.exitCode = 1;
  }
})();
