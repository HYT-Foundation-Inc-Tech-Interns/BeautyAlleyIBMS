import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

import { env } from "../config/env";

/**
 * Outbound mail, or a clear "not configured" answer.
 *
 * SMTP is optional on purpose: the reminder queue must keep working in a
 * deployment that has not been given a mail account, and the sender marks those
 * rows SKIPPED rather than crashing the cron. The one thing this module refuses
 * to do is pretend it sent something.
 */

export function smtpConfigured(): boolean {
  // A username without a password is a half-configured account: report it as
  // not configured rather than attempting an unauthenticated send.
  return Boolean(env.smtpHost && env.smtpFrom && (!env.smtpUser || env.smtpPass));
}

let cached: Transporter | null = null;

function transporter(): Transporter {
  if (!smtpConfigured()) {
    throw new Error("SMTP is not configured");
  }
  if (!cached) {
    cached = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      ...(env.smtpUser ? { auth: { user: env.smtpUser, pass: env.smtpPass } } : {}),
    });
  }
  return cached;
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  await transporter().sendMail({
    from: env.smtpFrom,
    to: input.to,
    subject: input.subject,
    text: input.text,
    ...(input.html ? { html: input.html } : {}),
  });
}
