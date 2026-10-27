"use client";

/**
 * The console landing page.
 *
 * It branches on role, and that branch is not cosmetic — it is the API's own
 * shape showing through. `/admin/dashboard` is `requireRole("ADMIN")`, so an
 * employee or a concierge cannot read it at all; what they *can* read is
 * `/bookings`, which is `OPERATIONS`. So:
 *
 *   ADMIN      gets the business summary — revenue, completion, no-show
 *              rate, the day-by-day curve and the top treatments by revenue.
 *   CONCIERGE  gets the run sheet — the desk's day in time order, with the
 *   EMPLOYEE   actions they actually take: moving a booking along its status
 *              machine, and (for the desk) reassigning a room.
 *
 * The alternative would be to hide the money tiles from the floor and show an
 * otherwise identical page, which is worse: it presents a filtered view as if
 * it were the whole picture. Different questions, different page.
 */

import * as React from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowRight,
  CalendarDays,
  CalendarRange,
  Check,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Sparkles,
  TrendingDown,
  UserRound,
  Wallet,
} from "lucide-react";

import {
  branchDay,
  branchTime,
  branchToday,
  cn,
  peso,
  relativeToNow,
  shiftDayKey,
  shortDate,
} from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { checkInBooking, isEarlyArrival } from "@/lib/check-in";
import { useAsync } from "@/lib/useAsync";
import type { Booking, BookingStatus } from "@/lib/api-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, StatTile } from "@/components/app/bits";
import { EmptyNote, ErrorNote, Loading, PersonAvatar, StatusBadge } from "@/components/app/api-bits";
import { EarlyArrivalDialog } from "@/components/app/early-arrival-dialog";
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
  const [metric, setMetric] = React.useState<"bookings" | "revenue">("bookings");

  const to = branchToday();
  const from = shiftDayKey(to, -(days - 1));

  const summary = useAsync("overview:dashboard:" + from + ":" + to, () =>
    api.admin.dashboard(from, to),
  );

  /*
   * `created_at`, not `start_time`.
   *
   * Sorting by appointment time descending returns the *furthest-future*
   * bookings — the ones made weeks ago for a date nobody has thought about
   * since — and calls them "latest". What an owner opening the console wants
   * is what came in just now, which is a question about `created_at`.
   */
  const recent = useAsync("overview:recent", async () =>
    (await api.admin.bookings({ limit: 8, sort: "created_at", order: "desc" })).data,
  );

  /** One button, one refresh. Reloading the totals and leaving the list stale
   *  (or the reverse) is how a page ends up disagreeing with itself. */
  function refreshAll() {
    summary.reload();
    recent.reload();
  }

  const totals = summary.data?.totals;
  const noShowRate = totals && totals.bookings > 0 ? (totals.noShow / totals.bookings) * 100 : 0;
  const arrivedRate = totals && totals.bookings > 0 ? (totals.checkedIn / totals.bookings) * 100 : 0;

  /*
   * The API returns only days that have bookings. A seven-day window with one
   * booking therefore produced a single dot on the chart and a "daily average"
   * of 1.0 — true of the rows returned, wrong about the week. Fill the missing
   * days with zero so the curve, the peak and the average describe the period
   * that was actually asked for.
   */
  const series = React.useMemo(() => {
    const rows = new Map((summary.data?.byDay ?? []).map((d) => [d.day, d]));
    const days: { day: string; bookings: number; revenue: number }[] = [];
    for (let day = from; day <= to; day = shiftDayKey(day, 1)) {
      const row = rows.get(day);
      days.push({
        day,
        bookings: row?.bookings ?? 0,
        revenue: (row?.revenue_cents ?? 0) / 100,
      });
    }
    return days;
  }, [summary.data, from, to]);

  const peak = series.reduce<(typeof series)[number] | null>(
    (best, day) =>
      day.bookings > 0 && (best === null || day.bookings > best.bookings) ? day : best,
    null,
  );
  const dailyAverage = series.length
    ? series.reduce((sum, day) => sum + day.bookings, 0) / series.length
    : 0;
  const today = series.length ? series[series.length - 1] : null;

  /* Emerald for volume, gold for money — the two colours the salon prints in.
   * These are literals because Recharts needs a paint value, not a class; they
   * mirror the emerald primary and champagne-500 and must move with them. */
  const metricColor = metric === "bookings" ? "#1B4D3E" : "#A8874C";
  /* Pin the top of the plot to the data. Recharts' "auto" domain rounds a
   * single booking up to four, which leaves three quarters of the chart empty
   * and makes a busy day look like a flat line. */
  const chartMax = Math.max(
    1,
    ...series.map((day) => (metric === "bookings" ? day.bookings : day.revenue)),
  );

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      {/* ---------------------------------------------------------- *
       * Hero — identity on the left, today's numbers and the period
       * controls on the right. A short two-column band rather than a tall
       * banner: the page below is where the detail belongs.
       * ---------------------------------------------------------- */}
      <section className="hero-surface hero-grid relative overflow-hidden rounded-2xl px-5 py-6 shadow-lift sm:px-8 sm:py-7">
        <img
          src="/brand/logo-ivory.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -right-6 top-1/2 hidden size-[240px] -translate-y-1/2 object-contain opacity-[0.05] lg:block"
        />
        <div className="relative z-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
          <div className="min-w-0">
            <p className="flex items-center gap-2.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-champagne-300/85">
              <span aria-hidden className="h-px w-6 bg-champagne-300/50" />
              Admin console
            </p>
            <h1 className="mt-2 font-display text-[26px] font-semibold leading-tight tracking-tight text-primary-foreground sm:text-[30px]">
              Business overview
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-primary-foreground/65">
              Bookings, arrivals and revenue for the selected period — read live from the
              database, never cached.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground/80">
                <CalendarRange className="size-3.5" />
                {shortDate(from)} — {shortDate(to)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground/80">
                <span aria-hidden className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300/70" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-300" />
                </span>
                Live data
              </span>
            </div>
          </div>

          {/* Today's numbers, and the only two controls on the page. Keeping
              them in one glass panel anchors the right side of the band and
              stops the hero reading as a wide empty strip. */}
          <div className="rounded-xl border border-white/12 bg-white/[0.06] p-4 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/50">
                  Today
                </p>
                <p className="mt-1.5 truncate font-display text-[24px] font-semibold leading-none tabular-nums text-primary-foreground">
                  {today ? today.bookings : "—"}{" "}
                  <span className="text-[12.5px] font-medium text-primary-foreground/60">
                    bookings
                  </span>
                </p>
                <p className="mt-1.5 text-[11.5px] tabular-nums text-primary-foreground/55">
                  {today ? peso(today.revenue * 100) + " booked" : "No data yet"}
                </p>
              </div>
              <button
                type="button"
                onClick={refreshAll}
                aria-label="Refresh"
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-primary-foreground/70 transition-colors hover:bg-white/[0.14] hover:text-primary-foreground"
              >
                <RefreshCw
                  className={cn("size-3.5", (summary.loading || recent.loading) && "animate-spin")}
                />
              </button>
            </div>

            <div className="mt-4 flex rounded-full border border-white/12 bg-black/15 p-1">
              {[7, 14, 30].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDays(option)}
                  aria-pressed={days === option}
                  className={cn(
                    "flex-1 rounded-full py-1.5 text-[11.5px] font-semibold transition-colors",
                    days === option
                      ? "bg-primary-foreground text-sidebar shadow-sm"
                      : "text-primary-foreground/60 hover:text-primary-foreground",
                  )}
                >
                  {option}d
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- *
       * KPI row — a plain, aligned band under the hero. Each card carries
       * the trend or the rate it is talking about, so the number is never
       * bare.
       * ---------------------------------------------------------- */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary.error ? (
          <div className="sm:col-span-2 xl:col-span-4">
            <ErrorNote error={summary.error} onRetry={summary.reload} />
          </div>
        ) : summary.initial || !totals ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <Kpi
              label="Bookings"
              value={String(totals.bookings)}
              hint={totals.completed + " completed · " + totals.cancelled + " cancelled"}
              icon={CalendarDays}
              tone="primary"
              spark={series.map((d) => d.bookings)}
            />
            <Kpi
              label="Revenue"
              value={peso(totals.revenueCents)}
              hint="Completed bookings only"
              icon={Wallet}
              tone="accent"
              spark={series.map((d) => d.revenue)}
            />
            <Kpi
              label="Arrived"
              value={String(totals.checkedIn)}
              hint={arrivedRate.toFixed(0) + "% of bookings arrived"}
              icon={CheckCircle2}
              tone="success"
              bar={{ value: arrivedRate, tone: "success" }}
            />
            <Kpi
              label="No-show rate"
              value={noShowRate.toFixed(1) + "%"}
              hint={totals.noShow + " of " + totals.bookings + " bookings"}
              icon={TrendingDown}
              tone={noShowRate > 10 ? "danger" : "primary"}
              bar={{ value: noShowRate, tone: "danger" }}
            />
          </>
        )}
      </div>

      {totals && !summary.error && (
        <div className="mt-6 space-y-5">
            {/* ------------------------------------------------------ *
             * The curve. One metric at a time, chosen deliberately: two
             * scales on one plot is a chart nobody reads correctly.
             * ------------------------------------------------------ */}
            <section className="flex flex-col rounded-xl border border-border/70 bg-card shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5">
                <div>
                  <h2 className="font-display text-[18px] font-semibold tracking-tight">
                    Bookings &amp; revenue
                  </h2>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Daily totals across the selected period.
                  </p>
                </div>
                <div className="flex rounded-full bg-muted p-1">
                  {(["bookings", "revenue"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setMetric(option)}
                      aria-pressed={metric === option}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-[11.5px] font-semibold capitalize transition-all",
                        metric === option
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 h-[264px] px-2">
                {series.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-[13px] text-muted-foreground">
                    No bookings in this period.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id={"chart-fill-" + metric} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={metricColor} stopOpacity={0.24} />
                          <stop offset="100%" stopColor={metricColor} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        vertical={false}
                        stroke="rgba(27,77,62,0.10)"
                        strokeDasharray="3 6"
                      />
                      <XAxis
                        dataKey="day"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={10}
                        tick={{ fontSize: 11, fill: "#7C8A82" }}
                        tickFormatter={dayTick}
                      />
                      <YAxis
                        domain={[0, chartMax]}
                        tickCount={4}
                        allowDecimals={false}
                        width={46}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11, fill: "#7C8A82" }}
                        tickFormatter={(value: number) =>
                          metric === "revenue" ? compactPeso(value) : String(value)
                        }
                      />
                      <Tooltip
                        cursor={{
                          stroke: "rgba(27,77,62,0.20)",
                          strokeWidth: 1,
                          strokeDasharray: "4 4",
                        }}
                        content={<ChartTip />}
                      />
                      <Area
                        type="monotone"
                        dataKey={metric}
                        stroke={metricColor}
                        strokeWidth={2.25}
                        fill={"url(#chart-fill-" + metric + ")"}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="mt-auto grid grid-cols-3 divide-x divide-border/60 border-t border-border/60">
                <ChartStat
                  label="Best day"
                  value={peak ? peak.bookings + " booked" : "—"}
                  hint={peak ? shortDate(peak.day) : "—"}
                />
                <ChartStat
                  label="Daily average"
                  value={dailyAverage.toFixed(1)}
                  hint="bookings / day"
                />
                <ChartStat label="Period revenue" value={peso(totals.revenueCents)} hint="completed only" />
              </div>
            </section>

          {/* The two lists sit together, under the chart. They are similar
              heights, so neither leaves a column of empty page beside it. */}
          <div className="grid items-start gap-5 xl:grid-cols-[1.55fr_0.85fr]">
            <RecentBookings state={recent} />

            {/* ------------------------------------------------------ *
             * Top treatments — a ranked list, not another chart. Bars are
             * relative to the leader so the shape is readable at a glance.
             * ------------------------------------------------------ */}
            <section className="flex flex-col rounded-xl border border-border/70 bg-card shadow-soft">
              <div className="flex items-start justify-between gap-3 px-6 pt-5">
                <div>
                  <h2 className="font-display text-[18px] font-semibold tracking-tight">
                    Top treatments
                  </h2>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    By revenue from completed bookings.
                  </p>
                </div>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-champagne-400/20 text-champagne-600">
                  <Sparkles className="size-4" />
                </span>
              </div>

              {summary.data && summary.data.topServices.length > 0 ? (
                <ul className="mt-4 flex-1 space-y-0.5 px-3 pb-4">
                  {summary.data.topServices.slice(0, 5).map((service, index, all) => {
                    const max = all[0].revenue_cents || 1;
                    return (
                      <li
                        key={service.name}
                        className="rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              "flex size-6 shrink-0 items-center justify-center rounded-md text-[10.5px] font-bold tabular-nums",
                              index === 0
                                ? "bg-champagne-400/25 text-champagne-600"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <p className="truncate text-[12.5px] font-semibold">{service.name}</p>
                              <p className="shrink-0 text-[12px] font-semibold tabular-nums">
                                {peso(service.revenue_cents)}
                              </p>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                <span
                                  className="block h-full rounded-full bg-gradient-to-r from-primary/60 to-primary"
                                  style={{ width: (service.revenue_cents / max) * 100 + "%" }}
                                />
                              </span>
                              <span className="w-[62px] shrink-0 text-right text-[10.5px] tabular-nums text-muted-foreground">
                                {service.bookings} booked
                              </span>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="m-4 mt-6 rounded-lg border border-dashed border-border py-10 text-center text-[12.5px] text-muted-foreground">
                  No completed bookings yet.
                </p>
              )}

              <div className="mt-auto flex items-center gap-1.5 border-t border-border/60 px-6 py-3.5 text-[11px] text-muted-foreground">
                <Sparkles className="size-3.5 text-champagne-600" />
                Ranked by revenue from completed bookings.
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * KPI card
 * ------------------------------------------------------------------ */

const KPI_TONES = {
  primary: {
    accent: "from-primary/50 via-primary/25 to-transparent",
    badge: "bg-primary/10 text-primary",
    spark: "#1B4D3E",
  },
  accent: {
    accent: "from-champagne-400/70 via-champagne-400/30 to-transparent",
    badge: "bg-champagne-400/20 text-champagne-600",
    spark: "#A8874C",
  },
  success: {
    accent: "from-success/45 via-success/20 to-transparent",
    badge: "bg-success/10 text-success",
    spark: "#2B6A54",
  },
  danger: {
    accent: "from-destructive/45 via-destructive/20 to-transparent",
    badge: "bg-destructive/10 text-destructive",
    spark: "#B4472F",
  },
} as const;

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  spark,
  bar,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof KPI_TONES;
  spark?: number[];
  bar?: { value: number; tone: "success" | "danger" };
}) {
  const styles = KPI_TONES[tone];

  return (
    <article className="group relative overflow-hidden rounded-xl border border-border/70 bg-card p-5 shadow-lift transition-transform duration-300 ease-out-quart hover:-translate-y-0.5">
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r", styles.accent)} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-2.5 truncate font-display text-[26px] font-semibold leading-none tracking-tight tabular-nums">
            {value}
          </p>
        </div>
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", styles.badge)}>
          <Icon className="size-[17px]" />
        </span>
      </div>

      <p className="mt-2.5 text-[11.5px] leading-snug text-muted-foreground">{hint}</p>

      <div className="mt-3 flex h-7 items-end">
        {spark ? (
          <Sparkline values={spark} color={styles.spark} />
        ) : bar ? (
          <div className="mb-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                "block h-full rounded-full",
                bar.tone === "danger" ? "bg-destructive/70" : "bg-success/70",
              )}
              style={{ width: Math.min(100, Math.max(0, bar.value)) + "%" }}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function KpiSkeleton() {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-5 shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-3">
          <div className="h-2.5 w-20 animate-pulse rounded-full bg-muted" />
          <div className="h-6 w-24 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="size-9 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="mt-4 h-2.5 w-28 animate-pulse rounded-full bg-muted" />
    </div>
  );
}

/**
 * A tiny trend line, drawn by hand.
 *
 * Recharts is the right tool for the main chart and the wrong one for a
 * 78x28 sparkline: a responsive container inside a card adds a resize
 * observer and a legend worth of machinery for four numbers.
 */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const gradientId = React.useId().replace(/:/g, "");
  const points = values.length > 1 ? values : [0, 0];
  const width = 100;
  const height = 28;
  const pad = 3;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min;

  const coords = points.map((value, index) => {
    const x = pad + (index / (points.length - 1)) * (width - pad * 2);
    const y = span === 0 ? height / 2 : height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = coords
    .map(([x, y], index) => (index === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1))
    .join(" ");
  const area =
    line +
    " L" +
    coords[coords.length - 1][0].toFixed(1) +
    "," +
    height +
    " L" +
    coords[0][0].toFixed(1) +
    "," +
    height +
    " Z";
  return (
    <svg
      viewBox={"0 0 " + width + " " + height}
      preserveAspectRatio="none"
      aria-hidden
      className="h-7 w-full overflow-visible"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={"url(#" + gradientId + ")"} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function ChartStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="px-4 py-3.5 sm:px-5">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 truncate font-display text-[15px] font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * The tooltip shows both numbers, whichever series is on screen. A reader
 * hovering a point is asking "what happened that day", not "what is this
 * one line".
 */
function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload?: { bookings: number; revenue: number } }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-xl border border-border/80 bg-popover px-3.5 py-2.5 shadow-lift">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label ? shortDate(label) : ""}
      </p>
      <p className="mt-1.5 text-[13px] font-semibold tabular-nums">{point.bookings} bookings</p>
      <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">
        {peso(point.revenue * 100)} revenue
      </p>
    </div>
  );
}

/** "2026-10-17" -> "Oct 17" on the x-axis. */
const dayTick = (value: string) =>
  new Date(value + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

const compactPeso = (value: number) =>
  "₱" +
  new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(value);

/* ------------------------------------------------------------------ *
 * Recent bookings
 * ------------------------------------------------------------------ */

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
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="font-display text-[18px] font-semibold tracking-tight">Just booked</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Newest reservations first — the appointment itself may be weeks out.
          </p>
        </div>
        <Link
          to="/app/bookings?range=all"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/80 bg-card px-3.5 py-2 text-[12px] font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/[0.04]"
        >
          Open the full record
          <ArrowRight className="size-3.5" />
        </Link>
      </div>

      <div className="hidden grid-cols-[96px_minmax(0,1fr)_110px_90px_110px] items-center gap-4 border-y border-border/60 bg-muted/40 px-6 py-2.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground md:grid">
        <span>Appointment</span>
        <span>Guest</span>
        <span>Reference</span>
        <span className="text-right">Amount</span>
        <span>Status</span>
      </div>

      <div className={state.data && state.data.length > 0 ? "p-0" : "p-4"}>
        {state.error ? (
          <ErrorNote error={state.error} onRetry={state.reload} />
        ) : state.initial ? (
          <Loading label="Loading bookings…" />
        ) : state.data && state.data.length > 0 ? (
          <ul className="divide-y divide-border/50">
            {state.data.map((booking) => (
              /*
               * The row is the target, not a link buried at the end of it. The
               * overlay navigates into the record pre-filtered to this booking's
               * reference, so clicking a row lands on that row rather than on a
               * list of everything.
               */
              <li
                key={booking.id}
                className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-primary/[0.035] md:grid-cols-[96px_minmax(0,1fr)_110px_90px_110px] md:gap-4 md:px-6"
              >
                <span className="hidden w-[92px] shrink-0 flex-col leading-tight md:flex">
                  <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {branchDay(booking.startTime)}
                  </span>
                  <span className="mt-1 text-[12.5px] font-semibold tabular-nums">
                    {branchTime(booking.startTime)}
                  </span>
                </span>

                <div className="flex min-w-0 items-center gap-3">
                  <PersonAvatar
                    name={booking.client?.fullName ?? booking.guest?.name ?? "Guest"}
                    className="size-8 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold">
                      {booking.client?.fullName ?? booking.guest?.name ?? "Guest booking"}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {booking.items.map((i) => i.name).join(", ") || "—"} ·{" "}
                      {booking.employee.fullName} · booked {relativeToNow(booking.createdAt)}
                    </p>
                  </div>
                </div>

                <span className="hidden truncate font-mono text-[10.5px] text-muted-foreground md:block">
                  {booking.reference}
                </span>

                <span className="hidden text-right text-[12.5px] font-semibold tabular-nums md:block">
                  {peso(booking.totalCents)}
                </span>

                <span className="justify-self-start">
                  <StatusBadge status={booking.status} />
                </span>

                <Link
                  to={"/app/bookings?range=all&q=" + encodeURIComponent(booking.reference)}
                  className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="sr-only">
                    Open booking {booking.reference} for{" "}
                    {booking.client?.fullName ?? booking.guest?.name ?? "guest"}
                  </span>
                </Link>
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
 * EMPLOYEE and CONCIERGE — the run sheet
 * ------------------------------------------------------------------ */

/**
 * The one move each status is actually waiting for.
 *
 * The state machine in `NEXT_STATUS` is wider than the run sheet needs: a
 * PENDING booking legally has four successors, so rendering all of them puts
 * four buttons on every row and turns a twenty-booking day into eighty
 * decisions taken while standing up. The sheet shows the forward move — the
 * thing that happens next — and "No-show", which only appears once the guest
 * could actually fail to arrive.
 *
 * Cancel is deliberately absent: a cancellation is a correction to the record,
 * made at a desk with the booking in front of you, not a step in the queue. It
 * is still available on the full record at /app/bookings, where the same
 * `PATCH /bookings/:id/status` enforces the same rules.
 */
const PRIMARY_MOVE: Partial<Record<BookingStatus, { to: BookingStatus; label: string }>> = {
  PENDING: { to: "CONFIRMED", label: "Confirm" },
  CONFIRMED: { to: "CHECKED_IN", label: "Check in" },
  CHECKED_IN: { to: "IN_SERVICE", label: "Seat" },
  IN_SERVICE: { to: "COMPLETED", label: "Complete" },
};

/**
 * The desk's notification, and its override.
 *
 * A self-service booking arrives PENDING with a stylist already attached: the
 * server picks at random from the people who are qualified, rostered and free
 * at that time. The client never saw a name, so the desk is the first human to
 * review the match — this card is where they see it, and the select beside
 * each row is how they disagree.
 *
 * It renders only when something is waiting. An always-present panel reading
 * "no new requests" trains the eye to skip it, which is the opposite of a
 * notification.
 */
function NewRequests({ onChanged }: { onChanged: () => void }) {
  const pending = useAsync("overview:requests", async () =>
    (
      await api.bookings.list({
        status: "PENDING",
        from: branchToday(),
        limit: 20,
        sort: "created_at",
        order: "desc",
      })
    ).data,
  );

  const staff = useAsync("overview:requests:staff", async () =>
    (await api.employees.list({ limit: 50 })).data,
  );

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<ApiError | null>(null);

  async function reassign(booking: Booking, employeeId: string) {
    if (!employeeId || employeeId === booking.employee.id) return;
    setBusyId(booking.id);
    setError(null);
    try {
      await api.bookings.setEmployee(booking.id, employeeId);
      pending.reload();
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not change the stylist"),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function confirm(booking: Booking) {
    setBusyId(booking.id);
    setError(null);
    try {
      await api.bookings.setStatus(booking.id, "CONFIRMED");
      pending.reload();
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not confirm that booking"),
      );
    } finally {
      setBusyId(null);
    }
  }

  const rows = pending.data ?? [];
  if (pending.error) return <ErrorNote error={pending.error} onRetry={pending.reload} />;
  if (pending.initial || rows.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.04] shadow-soft">
      <div className="flex flex-wrap items-center gap-3 border-b border-primary/15 px-5 py-4">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary text-[13px] font-semibold tabular-nums text-primary-foreground">
          {rows.length}
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-[19px] font-semibold leading-tight tracking-tight">
            New requests
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Booked online with a stylist chosen for them. Change it, then confirm.
          </p>
        </div>
        {/*
          * This panel asks for pending bookings with no upper date bound, so it
          * can name a request that Bookings' default seven-day window does not
          * contain. The link carries both the status and "all dates", so the
          * record it points at is on the page when it opens.
          */}
        <Link
          to="/app/bookings?status=PENDING&range=all"
          className="ml-auto text-[12px] font-medium text-primary hover:underline"
        >
          All requests →
        </Link>
        <Button variant="ghost" size="sm" onClick={pending.reload}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {error && <ErrorNote error={error} className="m-4" />}

      <ul className="divide-y divide-border/60">
        {rows.map((booking) => {
          const guest = booking.client?.fullName ?? booking.guest?.name ?? "Guest booking";
          const known = staff.data?.some((person) => person.id === booking.employee.id) ?? true;
          return (
            <li key={booking.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <span className="flex min-w-[74px] shrink-0 flex-col leading-tight">
                <span className="text-[12.5px] font-semibold tabular-nums">
                  {branchTime(booking.startTime)}
                </span>
                <span className="text-[10.5px] text-muted-foreground">
                  {branchDay(booking.startTime)}
                </span>
              </span>

              <PersonAvatar name={guest} className="size-8 shrink-0" />

              <div className="min-w-[150px] flex-1">
                <p className="truncate text-[13px] font-medium">{guest}</p>
                <p className="truncate text-[11.5px] text-muted-foreground">
                  {booking.items.map((i) => i.name).join(", ") || "—"} · booked{" "}
                  {relativeToNow(booking.createdAt)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor={`stylist-${booking.id}`} className="sr-only">
                  Stylist for {guest}
                </label>
                <select
                  id={`stylist-${booking.id}`}
                  value={booking.employee.id}
                  disabled={busyId === booking.id || !staff.data}
                  onChange={(e) => void reassign(booking, e.target.value)}
                  className="h-9 max-w-[190px] rounded-lg border border-border bg-card px-2.5 text-[12.5px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                >
                  {!known && <option value={booking.employee.id}>{booking.employee.fullName}</option>}
                  {staff.data?.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                      {person.title ? ` — ${person.title}` : ""}
                    </option>
                  ))}
                </select>

                <Button
                  size="sm"
                  disabled={busyId === booking.id}
                  onClick={() => void confirm(booking)}
                >
                  <Check className="size-3.5" />
                  Confirm
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RunSheet({ name }: { name: string }) {
  const { role, can } = useAuth();
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
  const [earlyTarget, setEarlyTarget] = React.useState<Booking | null>(null);

  async function advance(booking: Booking, status: BookingStatus) {
    setBusyId(booking.id);
    setActionError(null);
    try {
      // Admitting a guest is the pass redemption, not a status write.
      if (status === "CHECKED_IN") await checkInBooking(booking.id);
      else await api.bookings.setStatus(booking.id, status);
      list.reload();
    } catch (err) {
      if (isEarlyArrival(err)) setEarlyTarget(booking);
      else
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

  /*
   * The desk's day is what has been agreed, and a PENDING booking has not been
   * agreed yet - it is sitting in the queue above, with the stylist picker and
   * the Confirm button that decide it. Rendering it here as well gave the desk
   * two cards for one 4:30 appointment: the request, and the same appointment
   * on the sheet. Confirming it in the queue puts it on the sheet; until then
   * the queue is the only place it appears.
   *
   * Only the desk, because only the desk has that queue. A therapist's page
   * has no way to confirm anything, so for them the request stays on the day.
   *
   * The counts above still include it - the day IS booked, that is why the
   * request matters - and the empty state below says where it went.
   */
  const sheetRows =
    role === "CONCIERGE" ? rows.filter((booking) => booking.status !== "PENDING") : rows;
  const pendingToday = rows.length - sheetRows.length;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-7">
      <PageHeader
        eyebrow="Your chair"
        icon={CalendarDays}
        title={`Good day${name ? `, ${name.split(" ")[0]}` : ""}.`}
        description={
          // While the list is in flight the counts are not 0, they are unknown —
          // and "0 bookings" is a claim, not a placeholder. Say what is actually
          // happening instead of asserting an empty day that may not be empty.
          list.initial
            ? "Reading today's diary…"
            : `Today's run sheet — ${rows.length} booking${rows.length === 1 ? "" : "s"}, ${arrived} already arrived.`
        }
        actions={
          <Button variant="outline" onClick={list.reload}>
            <RefreshCw className={cn("size-4", list.loading && "animate-spin")} />
            Refresh
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground/80">
            <CalendarDays className="size-3.5" />
            {shortDate(today)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground/80">
            <UserRound className="size-3.5" />
            {role === "CONCIERGE" ? "Front desk" : "The floor"}
          </span>
        </div>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="On the sheet"
          value={list.initial ? "—" : String(rows.length)}
          hint="booked for today"
          icon={CalendarDays}
        />
        <StatTile
          label="Arrived"
          value={list.initial ? "—" : String(arrived)}
          hint="checked in or in the chair"
          icon={CheckCircle2}
          tone="success"
        />
        <StatTile
          label="Still to come"
          value={list.initial ? "—" : String(Math.max(0, rows.length - arrived))}
          hint="yet to reach the desk"
          icon={Clock3}
          tone="accent"
        />
      </div>

      {actionError && <ErrorNote error={actionError} />}

      {/* The desk is the only role that may move a booking to another stylist,
          so the request queue is theirs. A therapist sees the run sheet below. */}
      {role === "CONCIERGE" && <NewRequests onChanged={list.reload} />}

      {list.error ? (
        <ErrorNote error={list.error} onRetry={list.reload} />
      ) : list.initial ? (
        <Loading label="Loading today's run sheet…" />
      ) : sheetRows.length === 0 && pendingToday > 0 ? (
        <EmptyNote
          icon={Clock3}
          title="Today is still a request"
          description={`The ${pendingToday === 1 ? "appointment" : `${pendingToday} appointments`} above ${pendingToday === 1 ? "is" : "are"} waiting to be confirmed. Confirming one puts it on the sheet.`}
        />
      ) : sheetRows.length === 0 ? (
        <EmptyNote
          icon={CalendarDays}
          title="Nothing on the sheet today"
          description="No appointments are booked for today. Walk-ins booked at the desk will appear here."
        />
      ) : (
        <ol className="space-y-3">
          {sheetRows.map((booking) => {
            const move = PRIMARY_MOVE[booking.status];
            const canNoShow =
              booking.status === "CONFIRMED" || booking.status === "CHECKED_IN";
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

                <div className="flex shrink-0 items-center gap-1.5">
                  {move ? (
                    <>
                      <Button
                        size="sm"
                        disabled={busyId === booking.id}
                        onClick={() => advance(booking, move.to)}
                      >
                        {move.label}
                        <ArrowRight className="size-3.5" />
                      </Button>
                      {canNoShow && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-clay hover:bg-clay/10"
                          disabled={busyId === booking.id}
                          onClick={() => advance(booking, "NO_SHOW")}
                        >
                          No-show
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="text-[11.5px] text-muted-foreground">Settled</span>
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
          {/* The desk lost the QR board; the floor kept it. Point each role at
              the door it actually has rather than at a page it cannot open. */}
          <Link
            to={can("check-in") ? "/app/check-in" : "/app/scan-arrivals"}
            className="font-medium text-primary hover:underline"
          >
            {can("check-in") ? "QR Check-in" : "Scan arrival pass"}
          </Link>
          .
        </p>
        <div className="flex items-center gap-2">
          {list.initial ? (
            <Badge variant="outline">Counting…</Badge>
          ) : (
            <>
              <Badge variant="outline">{rows.length} today</Badge>
              <Badge variant="success">{arrived} arrived</Badge>
            </>
          )}
        </div>
      </div>

      {earlyTarget && (
        <EarlyArrivalDialog
          booking={earlyTarget}
          onClose={() => setEarlyTarget(null)}
          onDone={() => {
            setEarlyTarget(null);
            list.reload();
          }}
        />
      )}
    </div>
  );
}
