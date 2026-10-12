"use client";

/**
 * The console landing page.
 *
 * It branches on role, and that branch is not cosmetic — it is the API's own
 * shape showing through. `/admin/dashboard` is `requireRole("ADMIN")`, so a
 * stylist cannot read it at all; what a stylist *can* read is `/bookings`,
 * which is `STAFF/ADMIN`. So:
 *
 *   ADMIN  gets the business summary — revenue, completion, no-show rate,
 *          the day-by-day curve and the top treatments by revenue.
 *   STAFF  gets the run sheet — today's chairs in time order, with the one
 *          action a stylist actually takes at the desk: moving a booking
 *          along its status machine.
 *
 * The alternative would be to hide the money tiles from staff and show an
 * otherwise identical page, which is worse: it presents a filtered view as if
 * it were the whole picture. Different questions, different page.
 */

import * as React from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserRound,
} from "lucide-react";

import { branchTime, branchToday, cn, peso, relativeToNow, shiftDayKey } from "@/lib/utils";
import { api, ApiError, NEXT_STATUS } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Booking, BookingStatus } from "@/lib/api-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/app/bits";
import { EmptyNote, ErrorNote, Loading, PersonAvatar, StatusBadge } from "@/components/app/api-bits";
import { useAuth } from "@/auth/AuthProvider";

const RANGE_DAYS = 7;

export default function Overview() {
  const { isAdmin, me, role } = useAuth();

  if (isAdmin) return <AdminOverview />;
  return <RunSheet name={me?.fullName ?? role ?? ""} />;
}

/* ------------------------------------------------------------------ *
 * ADMIN — the business summary
 * ------------------------------------------------------------------ */

function AdminOverview() {
  const [days, setDays] = React.useState(RANGE_DAYS);

  const to = branchToday();
  const from = shiftDayKey(to, -(days - 1));

  const summary = useAsync(`overview:dashboard:${from}:${to}`, () => api.admin.dashboard(from, to));

  const recent = useAsync("overview:recent", async () =>
    (await api.admin.bookings({ limit: 8, sort: "start_time", order: "desc" })).data,
  );

  const totals = summary.data?.totals;
  const noShowRate = totals && totals.bookings > 0 ? (totals.noShow / totals.bookings) * 100 : 0;

  const series =
    summary.data?.byDay.map((d) => ({
      day: d.day.slice(5),
      bookings: d.bookings,
      revenue: d.revenue_cents / 100,
    })) ?? [];

  return (
    <div className="mx-auto w-full max-w-[1300px] space-y-8">
      <SectionHeading
        eyebrow="Records"
        title="Overview"
        description={`Everything booked between ${from} and ${to}, read live from the database — no cached totals.`}
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-full border border-border bg-card p-0.5">
              {[7, 14, 30].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDays(option)}
                  aria-pressed={days === option}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors",
                    days === option
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option}d
                </button>
              ))}
            </div>
            <Button variant="outline" size="icon" aria-label="Refresh" onClick={summary.reload}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
        }
      />

      {summary.error ? (
        <ErrorNote error={summary.error} onRetry={summary.reload} />
      ) : summary.initial ? (
        <Loading label="Totalling the period…" />
      ) : totals ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Bookings"
              value={String(totals.bookings)}
              hint={`${totals.completed} completed`}
              icon={CalendarDays}
            />
            <Kpi
              label="Revenue"
              value={peso(totals.revenueCents)}
              hint="completed bookings only"
              icon={TrendingUp}
              tone="primary"
            />
            <Kpi
              label="Arrived"
              value={String(totals.checkedIn)}
              hint="checked in or beyond"
              icon={CheckCircle2}
            />
            <Kpi
              label="No-show rate"
              value={`${noShowRate.toFixed(1)}%`}
              hint={`${totals.noShow} of ${totals.bookings}`}
              icon={TrendingDown}
              tone={noShowRate > 10 ? "clay" : "default"}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <section className="rounded-xl border border-border/80 bg-card p-6 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-[19px] font-semibold tracking-tight">
                  Bookings per day
                </h2>
                <span className="text-[12px] text-muted-foreground">
                  {totals.cancelled} cancelled in this period
                </span>
              </div>
              <div className="mt-6 h-[240px]">
                {series.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-[13px] text-muted-foreground">
                    No bookings in this period.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                      <defs>
                        <linearGradient id="bookingsFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1B4D3E" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#1B4D3E" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="rgba(27,77,62,0.10)" />
                      <XAxis
                        dataKey="day"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11, fill: "#6b7a73" }}
                      />
                      <YAxis
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11, fill: "#6b7a73" }}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid rgba(27,77,62,0.15)",
                          fontSize: 12,
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="bookings"
                        stroke="#1B4D3E"
                        strokeWidth={2}
                        fill="url(#bookingsFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-border/80 bg-card p-6 shadow-soft">
              <h2 className="font-display text-[19px] font-semibold tracking-tight">
                Top treatments
              </h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                By revenue from completed bookings.
              </p>
              {summary.data && summary.data.topServices.length > 0 ? (
                <ul className="mt-5 space-y-4">
                  {summary.data.topServices.map((service, i, all) => {
                    const max = all[0].revenue_cents || 1;
                    return (
                      <li key={service.name}>
                        <div className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="truncate font-medium">{service.name}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {peso(service.revenue_cents)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <span
                              className="block h-full rounded-full bg-primary"
                              style={{ width: `${(service.revenue_cents / max) * 100}%` }}
                            />
                          </span>
                          <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                            {service.bookings} booked
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-6 rounded-lg border border-dashed border-border py-8 text-center text-[12.5px] text-muted-foreground">
                  No completed bookings yet.
                </p>
              )}
            </section>
          </div>

          <RecentBookings state={recent} />
        </>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "primary" | "clay";
}) {
  const toneClass =
    tone === "primary"
      ? "bg-primary text-primary-foreground"
      : tone === "clay"
        ? "bg-clay/10 text-clay"
        : "bg-primary/[0.08] text-primary";

  return (
    <div className="rounded-xl border border-border/80 bg-card p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        <span className={cn("flex size-8 items-center justify-center rounded-full", toneClass)}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-4 font-display text-[30px] font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-2 text-[11.5px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function RecentBookings({
  state,
}: {
  state: {
    data: Booking[] | null;
    error: ApiError | null;
    initial: boolean;
    reload: () => void;
  };
}) {
  return (
    <section className="rounded-xl border border-border/80 bg-card shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-6 py-4">
        <h2 className="font-display text-[19px] font-semibold tracking-tight">Latest bookings</h2>
        <Link
          to="/app/bookings"
          className="inline-flex items-center gap-1.5 text-[12.5px] text-primary hover:underline"
        >
          Open the full record
          <ArrowRight className="size-3.5" />
        </Link>
      </div>

      <div className="p-4">
        {state.error ? (
          <ErrorNote error={state.error} onRetry={state.reload} />
        ) : state.initial ? (
          <Loading label="Loading bookings…" />
        ) : state.data && state.data.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {state.data.map((booking) => (
              <li key={booking.id} className="flex flex-wrap items-center gap-4 px-2 py-3.5">
                <span className="w-16 shrink-0 text-[12.5px] font-semibold tabular-nums text-muted-foreground">
                  {branchTime(booking.startTime)}
                </span>
                <PersonAvatar
                  name={booking.client?.fullName ?? booking.guest?.name ?? "Guest"}
                  className="size-8 shrink-0"
                />
                <div className="min-w-[150px] flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {booking.client?.fullName ?? booking.guest?.name ?? "Guest booking"}
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {booking.items.map((i) => i.name).join(", ") || "—"} · {booking.employee.fullName}
                  </p>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {booking.reference}
                </span>
                <span className="text-[13px] font-medium tabular-nums">
                  {peso(booking.totalCents)}
                </span>
                <StatusBadge status={booking.status} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote
            icon={CalendarDays}
            title="No bookings yet"
            description="Nothing has been booked through the system."
          />
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * STAFF — the run sheet
 * ------------------------------------------------------------------ */

function RunSheet({ name }: { name: string }) {
  const today = branchToday();

  const list = useAsync(`overview:runsheet:${today}`, async () =>
    (
      await api.bookings.list({
        from: today,
        to: today,
        limit: 100,
        sort: "start_time",
        order: "asc",
      })
    ).data,
  );

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<ApiError | null>(null);

  async function advance(booking: Booking, status: BookingStatus) {
    setBusyId(booking.id);
    setActionError(null);
    try {
      await api.bookings.setStatus(booking.id, status);
      list.reload();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not move that booking"),
      );
    } finally {
      setBusyId(null);
    }
  }

  const rows = list.data ?? [];
  const arrived = rows.filter((b) =>
    ["CHECKED_IN", "IN_SERVICE", "COMPLETED"].includes(b.status),
  ).length;

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-7">
      <SectionHeading
        eyebrow="Your chair"
        title={`Good day${name ? `, ${name.split(" ")[0]}` : ""}.`}
        description={`Today's run sheet — ${rows.length} booking${rows.length === 1 ? "" : "s"}, ${arrived} already arrived.`}
        action={
          <Button variant="outline" onClick={list.reload}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      {actionError && <ErrorNote error={actionError} />}

      {list.error ? (
        <ErrorNote error={list.error} onRetry={list.reload} />
      ) : list.initial ? (
        <Loading label="Loading today's run sheet…" />
      ) : rows.length === 0 ? (
        <EmptyNote
          icon={CalendarDays}
          title="Nothing on the sheet today"
          description="No appointments are booked for today. Walk-ins booked at the desk will appear here."
        />
      ) : (
        <ol className="space-y-3">
          {rows.map((booking) => {
            const next = NEXT_STATUS[booking.status];
            const guest = booking.client?.fullName ?? booking.guest?.name ?? "Guest booking";
            return (
              <li
                key={booking.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-border/80 bg-card p-5 shadow-soft"
              >
                <span className="flex min-w-[70px] flex-col rounded-lg bg-sand-50 px-3 py-2 text-center">
                  <span className="font-display text-[16px] font-semibold leading-none tabular-nums">
                    {branchTime(booking.startTime)}
                  </span>
                  <span className="mt-1 text-[10px] text-muted-foreground">
                    {relativeToNow(booking.startTime)}
                  </span>
                </span>

                <PersonAvatar name={guest} className="size-10 shrink-0" />

                <div className="min-w-[170px] flex-1">
                  <p className="font-display text-[17px] font-semibold leading-tight tracking-tight">
                    {guest}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="size-3" />
                      {booking.items.map((i) => i.name).join(", ") || "—"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="size-3" />
                      {booking.employee.fullName}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="size-3" />
                      {booking.items.reduce((n, i) => n + i.durationMinutes, 0)} min
                    </span>
                  </p>
                  {booking.notes && (
                    <p className="mt-1.5 truncate text-[11.5px] text-champagne-600">
                      Note: {booking.notes}
                    </p>
                  )}
                </div>

                <StatusBadge status={booking.status} />

                <div className="flex flex-wrap items-center gap-1.5">
                  {next.length === 0 ? (
                    <span className="text-[11.5px] text-muted-foreground">Settled</span>
                  ) : (
                    next.map((status) => (
                      <Button
                        key={status}
                        size="sm"
                        variant={status === "NO_SHOW" || status === "CANCELLED" ? "ghost" : "outline"}
                        className={cn(
                          (status === "NO_SHOW" || status === "CANCELLED") &&
                            "text-clay hover:bg-clay/10",
                        )}
                        disabled={busyId === booking.id}
                        onClick={() => advance(booking, status)}
                      >
                        {status === "CHECKED_IN"
                          ? "Arrived"
                          : status === "IN_SERVICE"
                            ? "Seated"
                            : status === "COMPLETED"
                              ? "Done"
                              : status === "NO_SHOW"
                                ? "No-show"
                                : status === "CANCELLED"
                                  ? "Cancel"
                                  : "Confirm"}
                      </Button>
                    ))
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/80 bg-sand-50 px-5 py-4">
        <p className="text-[12.5px] text-muted-foreground">
          A guest's pass is scanned at the door from{" "}
          <Link to="/app/check-in" className="font-medium text-primary hover:underline">
            QR Check-in
          </Link>
          .
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{rows.length} today</Badge>
          <Badge variant="success">{arrived} arrived</Badge>
        </div>
      </div>
    </div>
  );
}
