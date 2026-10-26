"use client";

/**
 * The desk, inside the console.
 *
 * Two things happen here, and they are genuinely different:
 *
 *   1. **Redeem a pass.** The guest shows their QR; the front desk pastes or
 *      scans the `BA1.…` token and `POST /qr/check-in` decides. The signature
 *      is verified first and then the `qr_tokens` row is consulted, because a
 *      signature proves *we* issued a pass but says nothing about whether it
 *      has already been used or was revoked. The server is the authority on
 *      that; this page just relays the answer.
 *
 *   2. **The walk-in code.** `GET /qr/branch` returns the code mounted at
 *      reception, which simply points at the public booking page. Note the
 *      API is explicit that this code `authorises: false` — it is a shortcut to
 *      the booking form, not a credential. It is rendered as such.
 *
 * Today's arrivals come from the ordinary bookings list, bounded to the
 * branch's calendar day in `Asia/Manila`. The bounds are sent as plain
 * `YYYY-MM-DD` days and the API resolves them in the branch's zone — the same
 * contract the run sheet uses, so "today" means the same thing on both pages.
 */

import * as React from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  BadgeCheck,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Loader2,
  QrCode,
  ScanLine,
  Users,
} from "lucide-react";

import { branchLongDay, branchTime, branchToday, peso } from "@/lib/utils";
import { api, ApiError, NEXT_STATUS, STATUS_ACTION } from "@/lib/api";
import type { Booking, CheckInResult } from "@/lib/api-types";
import { useAsync } from "@/lib/useAsync";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  EmptyNote,
  ErrorNote,
  Loading,
  PersonAvatar,
  StatusBadge,
} from "@/components/app/api-bits";
import { Reveal } from "@/components/app/reveal";
import { PageHeader, Panel, StatTile } from "@/components/app/bits";
import { CameraScanner } from "@/components/app/camera-scanner";

/** `YYYY-MM-DD` at the branch -> the UTC instants that bracket it. */
const ARRIVED: Booking["status"][] = ["CHECKED_IN", "IN_SERVICE", "COMPLETED"];

/* ------------------------------------------------------------------ *
 * Redeem
 * ------------------------------------------------------------------ */

function Redeem() {
  const [pass, setPass] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [done, setDone] = React.useState<CheckInResult | null>(null);

  /**
   * Redeem whatever we were handed — a scanned string or a pasted one.
   *
   * The camera and the text box are the same door, so they share one function.
   * A scan is a deliberate act at the desk (the guest is holding the pass up),
   * so it submits; the arrival-confirmation flow, which does *not* commit on a
   * scan, lives on /app/scan-arrivals.
   */
  async function redeem(raw: string) {
    const value = raw.trim();
    if (busy || !value) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setDone(await api.qr.checkIn(value));
      setPass("");
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not check that in"));
      // Leave the value in the box so the desk can see what was read and try
      // again, instead of losing the scan to a cleared field.
      setPass(value);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void redeem(pass);
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="text-[17px]">Redeem an arrival pass</CardTitle>
        <CardDescription>
          Hold the guest's code up to the camera, or paste it. Each pass works once.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center gap-4">
        {done ? (
          <div className="relative flex min-h-[280px] flex-col items-center justify-center overflow-hidden rounded-xl border border-border/80 bg-sidebar px-6 text-center">
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.14]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px)",
                backgroundSize: "26px 26px",
              }}
            />
            <div className="relative">
              <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                <CheckCircle2 className="size-7" />
              </span>
              <p className="mt-4 font-display text-[22px] font-semibold text-primary-foreground">
                {done.reference}
              </p>
              <p className="mt-1 text-[12.5px] text-primary-foreground/65">
                Checked in at {branchTime(done.checkedInAt)}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-5 border-white/20 bg-white/[0.08] text-primary-foreground hover:bg-white/[0.16]"
                onClick={() => setDone(null)}
              >
                <ScanLine className="size-3.5" />
                Scan the next guest
              </Button>
            </div>
          </div>
        ) : (
          /*
           * Paused while a request is in flight *and* while an error is on
           * screen. Without the second half, a pass the server refuses stays
           * in front of the lens and is re-submitted on every decoded frame —
           * the desk would see the same refusal hammering the API until they
           * moved the paper away.
           */
          <CameraScanner onCode={(raw) => void redeem(raw)} paused={busy || !!error} />
        )}

        <form onSubmit={submit} className="space-y-3">
          <textarea
            value={pass}
            onChange={(e) => {
              setPass(e.target.value);
              setError(null);
            }}
            rows={2}
            placeholder="BA1.… or the URL the QR encodes"
            aria-label="Arrival pass"
            className="w-full resize-none rounded-lg border border-border bg-card px-3.5 py-3 font-mono text-[12px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
          />
          <Button type="submit" disabled={busy || !pass.trim()}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Checking in…
              </>
            ) : (
              <>
                <BadgeCheck className="size-4" />
                Check in this guest
              </>
            )}
          </Button>
        </form>

        {/* Dismissing the error resumes the camera, so a refused pass can be
            re-presented once the desk has read why it failed. */}
        {error && <ErrorNote error={error} onRetry={() => setError(null)} />}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Walk-in code
 * ------------------------------------------------------------------ */

function WalkInCode() {
  const branch = useAsync("qr:branch", () => api.qr.branch());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[17px]">The code at reception</CardTitle>
        <CardDescription>
          A walk-in scans this and lands on the booking desk — no account needed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {branch.initial ? (
          <Loading label="Loading the branch code…" />
        ) : branch.error ? (
          <ErrorNote error={branch.error} onRetry={branch.reload} />
        ) : branch.data ? (
          <div className="flex flex-col items-center">
            <div className="rounded-2xl bg-white p-5 ring-1 ring-border">
              <QRCodeSVG
                value={branch.data.url}
                size={168}
                bgColor="#ffffff"
                fgColor="#1B4D3E"
                level="M"
              />
            </div>
            <p className="mt-4 text-center text-[13px] font-medium">{branch.data.label}</p>
            <p className="mt-1 break-all text-center text-[11.5px] text-muted-foreground">
              {branch.data.url}
            </p>
            <p className="mt-4 rounded-lg bg-muted/60 px-3.5 py-2.5 text-center text-[11.5px] leading-relaxed text-muted-foreground">
              Arrival passes stay valid for {branch.data.checkInWindowMinutes} minutes around the
              appointment. This code is a shortcut to the booking form — it grants no access
              {branch.data.authorises ? "" : ", and the API says so explicitly"}.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * How a pass works
 * ------------------------------------------------------------------ */

function PassRules() {
  return (
    <Panel className="px-5 py-5">
      <h2 className="font-display text-[17px] font-semibold tracking-tight">How a pass works</h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Three rules the server enforces, not the screen.
      </p>
      <div className="mt-4 space-y-4">
        {[
          { icon: QrCode, title: "One code per booking", body: "A pass is bound to a single booking and expires on its own schedule, so a screenshot cannot be reused." },
          { icon: ScanLine, title: "Signature, then record", body: "The signature proves the salon issued the pass; the stored row decides whether it is still good." },
          { icon: BadgeCheck, title: "Only the desk arrives you", body: "Checking in is a staff action. A client cannot mark themselves as arrived." },
        ].map((f) => (
          <div key={f.title} className="flex gap-3.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/[0.07] text-primary">
              <f.icon className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium leading-tight">{f.title}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Today
 * ------------------------------------------------------------------ */

function Today() {
  const today = branchToday();
  // Midday at the branch: a label needs a safe instant inside the day, not its
  // first millisecond, or a timezone slip could name the wrong date.
  const todayLabel = branchLongDay(`${today}T12:00:00+08:00`);

  const list = useAsync(`checkin:today:${today}`, () =>
    api.bookings.list({
      from: today,
      to: today,
      limit: 100,
      sort: "start_time",
      order: "asc",
    }),
  );

  const [moving, setMoving] = React.useState<string | null>(null);
  const [moveError, setMoveError] = React.useState<ApiError | null>(null);

  async function advance(booking: Booking, status: Booking["status"]) {
    setMoving(booking.id);
    setMoveError(null);
    try {
      await api.bookings.setStatus(booking.id, status);
      list.reload();
    } catch (err) {
      setMoveError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not update"));
    } finally {
      setMoving(null);
    }
  }

  const rows = list.data?.data ?? [];
  const arrived = rows.filter((b) => ARRIVED.includes(b.status));
  const expected = rows.filter((b) => b.status === "PENDING" || b.status === "CONFIRMED");

  const stats = [
    { label: "Booked today", value: String(rows.length), icon: CalendarCheck, hint: todayLabel },
    { label: "Checked in", value: String(arrived.length), icon: BadgeCheck, hint: "arrived and seated" },
    { label: "Still to arrive", value: String(expected.length), icon: Clock3, hint: expected.length ? `next ${branchTime(expected[0].startTime)}` : "nobody outstanding" },
    {
      label: "Expected takings",
      value: peso(rows.reduce((sum, b) => sum + b.totalCents, 0)),
      icon: Users,
      hint: "booked value, before no-shows",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <StatTile key={s.label} label={s.label} value={s.value} hint={s.hint} icon={s.icon} />
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-[17px]">Today's arrivals</CardTitle>
            <CardDescription>{todayLabel} · branch time</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={list.reload}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {moveError && <ErrorNote error={moveError} />}

          {list.initial ? (
            <Loading label="Loading today's book…" />
          ) : list.error ? (
            <ErrorNote error={list.error} onRetry={list.reload} />
          ) : rows.length === 0 ? (
            <EmptyNote
              icon={CalendarCheck}
              title="Nothing booked today"
              description="When a booking is made for today it will appear here, ready to check in."
            />
          ) : (
            <div className="scroll-slim max-h-[560px] space-y-1.5 overflow-y-auto">
              {rows.map((booking) => {
                const name =
                  booking.client?.fullName ?? booking.guest?.name ?? "Walk-in guest";
                const services = booking.items.map((i) => i.name).join(", ");
                const next = NEXT_STATUS[booking.status].filter((s) =>
                  s === "CHECKED_IN" || s === "COMPLETED" || s === "NO_SHOW",
                );
                return (
                  <div
                    key={booking.id}
                    className="flex items-center gap-3.5 rounded-lg border border-border/70 bg-background p-3"
                  >
                    <PersonAvatar name={name} className="size-9 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{name}</p>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {branchTime(booking.startTime)} · {services || booking.reference}
                      </p>
                      <p className="truncate text-[10.5px] text-muted-foreground/80">
                        {booking.employee.fullName}
                        {booking.client ? "" : " · guest pass"}
                      </p>
                    </div>
                    <StatusBadge status={booking.status} />
                    {next.length > 0 && (
                      <div className="hidden shrink-0 gap-1.5 sm:flex">
                        {next.map((status) => (
                          <Button
                            key={status}
                            size="sm"
                            variant={status === "NO_SHOW" ? "ghost" : "outline"}
                            disabled={moving === booking.id}
                            onClick={() => void advance(booking, status)}
                          >
                            {moving === booking.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              STATUS_ACTION[status]
                            )}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function CheckIn() {
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-8">
      <PageHeader
        eyebrow="QR check-in"
        icon={QrCode}
        title="Arrivals, handled."
        description="Every booking carries its own pass. Scan it and the floor knows who is here, who is next and who is late."
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground/80">
            <span aria-hidden className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300/70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-300" />
            </span>
            Live at the door
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground/80">
            <CalendarCheck className="size-3.5" />
            {branchLongDay(new Date().toISOString())}
          </span>
        </div>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-2">
        <Reveal className="h-full">
          <Redeem />
        </Reveal>
        <Reveal delay={80}>
          <div className="space-y-6">
            <WalkInCode />
            <PassRules />
          </div>
        </Reveal>
      </div>

      <Today />
    </div>
  );
}
