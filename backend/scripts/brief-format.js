/**
 * The owner's brief, as words.
 *
 * Pure functions only: no database, no SMTP, no environment. `daily-brief.js`
 * fetches the facts and sends the result; this file decides what the facts
 * mean, which is the part worth testing.
 *
 * The rule the copy follows is the same one the console follows: say the number
 * and the comparison together. "2 no-shows" is not information; "2 no-shows
 * against 0.5 on an average Tuesday" is.
 */

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const pesoExact = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₱12,400, or ₱12,400.50 when the centavos are not zero. */
function money(cents) {
  const value = Number(cents) || 0;
  return value % 100 === 0 ? peso.format(value / 100) : pesoExact.format(value / 100);
}

/** 9h 12m · 45m · 27h — the unit that makes a number mean something. */
function duration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** A whole percentage, or null when the denominator is zero. */
function percent(part, whole) {
  const p = Number(part) || 0;
  const w = Number(whole) || 0;
  if (w <= 0) return null;
  return Math.round((p / w) * 100);
}

/** Chair-hours, as a percentage. Null on a day nobody was rota'd on. */
function utilisationPct(utilisation) {
  if (!utilisation) return null;
  return percent(utilisation.bookedMinutes, utilisation.staffedMinutes);
}

/** "Tuesday 10 November", from the date the payload carries. */
function dateLabel(brief) {
  const [year, month, day] = String(brief.date).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const monthName = date.toLocaleDateString("en-PH", { month: "long", timeZone: "UTC" });
  return `${brief.weekday} ${day} ${monthName}`;
}

/**
 * The one thing worth reading, or null when yesterday was ordinary.
 *
 * The order is deliberate and is the whole editorial judgement:
 *
 *   1. nothing booked on a staffed day - the loudest fact there is
 *   2. no-shows - money already lost, and a person who can still be called
 *   3. cancellations - money about to be lost
 *   4. takings well under the weekday's own baseline
 *   5. chairs idle, even though the takings may look fine
 *
 * Comparisons need a baseline. Without four earlier same-weekday days, only the
 * absolute checks run - a "2 no-shows" that cannot be called double is still
 * worth a sentence, but it must not be dressed up as a trend.
 */
function pickAnomaly(brief) {
  const totals = brief.totals;
  const trailing = brief.trailing ?? { weeks: 0 };
  const baseline = (trailing.weeks ?? 0) > 0;
  const staffed = brief.utilisation?.staffedMinutes ?? 0;
  const booked = brief.utilisation?.bookedMinutes ?? 0;
  const idle = utilisationPct(brief.utilisation);

  if (totals.bookings === 0 && staffed > 0) {
    return {
      kind: "empty",
      text: `Nobody was booked, with ${duration(staffed)} of chair time on the rota.`,
    };
  }

  if (totals.noShow >= 2 && (!baseline || totals.noShow >= Math.max(2, trailing.avgNoShow * 2))) {
    return {
      kind: "no-shows",
      text: baseline
        ? `No-shows: ${totals.noShow} yesterday, against ${trailing.avgNoShow} on an average ${brief.weekday}.`
        : `${totals.noShow} no-shows, and there is no earlier ${brief.weekday} to compare with.`,
    };
  }

  if (totals.cancelled >= 3 && (!baseline || totals.cancelled >= Math.max(3, trailing.avgCancelled * 1.5))) {
    return {
      kind: "cancellations",
      text: baseline
        ? `${totals.cancelled} cancellations, against ${trailing.avgCancelled} on an average ${brief.weekday}.`
        : `${totals.cancelled} cancellations yesterday.`,
    };
  }

  if (baseline && trailing.avgRevenueCents > 0 && totals.revenueCents < trailing.avgRevenueCents * 0.6) {
    return {
      kind: "revenue",
      text: `Takings were ${percent(totals.revenueCents, trailing.avgRevenueCents)}% of the ${brief.weekday} average of ${money(trailing.avgRevenueCents)}.`,
    };
  }

  if (idle !== null && idle < 35 && booked > 0) {
    return {
      kind: "idle",
      text: `Only ${idle}% of the staffed hours were booked — ${duration(booked)} of ${duration(staffed)}.`,
    };
  }

  return null;
}

/** The inbox is the only interface, so the subject has to carry the day. */
function subjectFor(brief) {
  const noShow = brief.totals.noShow;
  const tail = noShow > 0 ? ` · ${noShow} no-show${noShow === 1 ? "" : "s"}` : "";
  return `${dateLabel(brief)} — ${money(brief.totals.revenueCents)}${tail}`;
}

/**
 * The numbers, one per line, in the order an owner reads them: what came in,
 * how busy it was, who is coming back, and what looks wrong.
 */
function lines(brief, opts = {}) {
  const totals = brief.totals;
  const utilisation = brief.utilisation ?? { bookedMinutes: 0, staffedMinutes: 0 };
  const retention = brief.retention ?? { clientsSeen: 0, rebooked: 0 };
  const idle = utilisationPct(utilisation);

  const revenue = opts.targetCents
    ? `${money(totals.revenueCents)}  of ${money(opts.targetCents)} target (${percent(totals.revenueCents, opts.targetCents)}%)`
    : money(totals.revenueCents);

  const out = [
    ["Revenue", revenue],
    [
      "Bookings",
      `${totals.bookings}  ${totals.completed} completed · ${totals.cancelled} cancelled · ${totals.noShow} no-show${totals.noShow === 1 ? "" : "s"}`,
    ],
    [
      "Chair-hours",
      idle === null
        ? "nobody on the rota"
        : `${idle}%  ${duration(utilisation.bookedMinutes)} booked of ${duration(utilisation.staffedMinutes)}`,
    ],
    [
      "Rebooked",
      retention.clientsSeen === 0
        ? "no clients seen"
        : `${retention.rebooked} of ${retention.clientsSeen}  clients seen have booked again`,
    ],
  ];

  if (brief.topService?.name) {
    out.push(["Most booked", `${brief.topService.name} (${brief.topService.bookings})`]);
  }

  return out;
}

function textBody(brief, opts = {}) {
  const salon = opts.salonName ?? "The Beauty Alley";
  const anomaly = pickAnomaly(brief);
  const rows = lines(brief, opts);
  const width = Math.max(...rows.map(([label]) => label.length));

  return [
    `${salon} — ${dateLabel(brief)}`,
    "",
    ...rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`),
    "",
    anomaly ? `Watch: ${anomaly.text}` : "Nothing unusual.",
    "",
    "The same numbers are on Insights.",
  ].join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlBody(brief, opts = {}) {
  const salon = opts.salonName ?? "The Beauty Alley";
  const anomaly = pickAnomaly(brief);
  const rows = lines(brief, opts);

  const row = ([label, value]) => `
      <tr>
        <td style="padding:6px 0;font:600 11px/1.4 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8A6C36;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:6px 0 6px 16px;font:400 14px/1.5 Arial,sans-serif;color:#0E2B23;">${escapeHtml(value)}</td>
      </tr>`;

  return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#FBF9F4;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #EDE7D8;border-radius:12px;padding:24px;">
    <p style="margin:0;font:600 10px/1.4 Arial,sans-serif;letter-spacing:.24em;text-transform:uppercase;color:#8A6C36;">${escapeHtml(salon)}</p>
    <h1 style="margin:6px 0 18px;font:600 22px/1.3 Georgia,serif;color:#0E2B23;">${escapeHtml(dateLabel(brief))}</h1>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${rows.map(row).join("")}
    </table>
    <p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #EDE7D8;font:400 14px/1.6 Arial,sans-serif;color:#0E2B23;">
      ${anomaly ? `<strong>Watch:</strong> ${escapeHtml(anomaly.text)}` : "Nothing unusual."}
    </p>
    <p style="margin:14px 0 0;font:400 11px/1.6 Arial,sans-serif;color:#6B7A74;">
      The same numbers are on Insights, for any day you choose.
    </p>
  </div>
</body>
</html>`;
}

module.exports = {
  money,
  duration,
  percent,
  utilisationPct,
  dateLabel,
  pickAnomaly,
  subjectFor,
  lines,
  textBody,
  htmlBody,
};
