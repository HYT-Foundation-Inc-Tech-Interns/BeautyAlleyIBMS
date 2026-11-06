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
  Check,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Sparkles,
  UserRound,
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
import type { Booking, BookingStatus, Employee } from "@/lib/api-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, StatTile } from "@/components/app/bits";
import { EmptyNote, ErrorNote, Loading, PersonAvatar, StatusBadge } from "@/components/app/api-bits";
import { EarlyArrivalDialog } from "@/components/app/early-arrival-dialog";
import { useAuth } from "@/auth/AuthProvider";

const RANGE_DAYS = 7;

export default function Overview() {
  const { me, role } = useAuth();

  // Today is the same surface for every staff role. The owner's analytics live
  // in Insights; keeping a second dashboard here meant two places to maintain
  // and two answers to "how was today".
  return <RunSheet name={me?.fullName ?? role ?? ""} />;
}

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

  /*
   * Who each request may be moved to.
   *
   * Not the whole roster. `reassign_booking_employee` refuses anyone inactive
   * or not qualified for every treatment on the booking, so offering them was
   * offering a refusal the concierge could not have predicted.
   * `/employees?serviceId=` applies the same qualification filter the database
   * does (`employee_services` + `is_active`), asked once per distinct treatment
   * in the panel rather than once per row.
   *
   * Availability is deliberately not filtered here: no endpoint answers "who
   * can take this exact booking", and the function owns the rota, leave and
   * overlap checks anyway. Someone who turns out to be busy is refused with a
   * sentence, which this panel already shows.
   */
  const serviceIds = React.useMemo(
    () => [...new Set((pending.data ?? []).flatMap((b) => b.items.map((i) => i.serviceId)))].sort(),
    [pending.data],
  );

  const qualified = useAsync(`overview:requests:qualified:${serviceIds.join(",")}`, async () => {
    const lists = await Promise.all(
      serviceIds.map(async (serviceId) => {
        const page = await api.employees.list({
          serviceId,
          limit: 100,
          sort: "full_name",
          order: "asc",
        });
        return [serviceId, page.data] as const;
      }),
    );
    return new Map(lists);
  });

  /**
   * The candidates for one request: everyone qualified for *every* treatment
   * on it. Intersected here rather than fetched per combination, because the
   * panel would otherwise need one request per booking.
   */
  function candidatesFor(booking: Booking): Employee[] {
    const lists = booking.items
      .map((item) => qualified.data?.get(item.serviceId))
      .filter((list): list is Employee[] => Boolean(list));
    if (lists.length === 0) return [];
    return lists.reduce((acc, list) => acc.filter((p) => list.some((q) => q.id === p.id)));
  }

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
          const candidates = candidatesFor(booking);
          const known = candidates.some((person) => person.id === booking.employee.id);
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
                  disabled={busyId === booking.id || !qualified.data}
                  onChange={(e) => void reassign(booking, e.target.value)}
                  className="h-9 max-w-[190px] rounded-lg border border-border bg-card px-2.5 text-[12.5px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                >
                  {/* The stylist already on the booking stays visible even if
                      they are not a candidate any more - they are the answer
                      to "who has it", and a blank select would read as data
                      loss rather than "nobody qualified can take it". */}
                  {!known && (
                    <option value={booking.employee.id}>
                      {booking.employee.fullName}
                      {qualified.data ? " (not a candidate)" : ""}
                    </option>
                  )}
                  {candidates.map((person) => (
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

/**
 * An EMPLOYEE whose login is not linked to an employees row.
 *
 * The API refuses their run sheet with EMPLOYEE_NOT_LINKED - they are allowed
 * to read a chair, they just do not have one. That is a fact about the record,
 * not a failure to retry, so the page says what it is and who can fix it,
 * rather than offering a Try again that can never succeed.
 */
function UnlinkedAccount({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyNote
      icon={UserRound}
      title="This login has no chair yet"
      description="The account is not linked to an employee record, so there is no day to show. The owner can link it from Team — once they do, this page fills in."
      action={
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="size-4" />
          Check again
        </Button>
      }
    />
  );
}

/**
 * The one forward move for each status, shown as a single button on the run
 * sheet. Everything else (cancel, no-show) is still available on the full
 * record at /app/bookings, where the same `PATCH /bookings/:id/status` enforces
 * the same rules.
 */
const PRIMARY_MOVE: Partial<Record<BookingStatus, { to: BookingStatus; label: string }>> = {
  PENDING: { to: "CONFIRMED", label: "Confirm" },
  CONFIRMED: { to: "CHECKED_IN", label: "Check in" },
  CHECKED_IN: { to: "IN_SERVICE", label: "Seat" },
  IN_SERVICE: { to: "COMPLETED", label: "Complete" },
};

function RunSheet({ name }: { name: string }) {
  const { role } = useAuth();
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
          <div className="flex flex-wrap gap-2">
            {role === "ADMIN" && (
              <Link to="/app/insights">
                <Button variant="outline">Insights</Button>
              </Link>
            )}
            <Button variant="outline" onClick={list.reload}>
              <RefreshCw className={cn("size-4", list.loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground/80">
            <CalendarDays className="size-3.5" />
            {shortDate(today)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground/80">
            <UserRound className="size-3.5" />
            {role === "EMPLOYEE" ? "The floor" : "Front desk"}
          </span>
        </div>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="On the sheet"
          value={list.initial || list.error ? "—" : String(rows.length)}
          hint="booked for today"
          icon={CalendarDays}
        />
        <StatTile
          label="Arrived"
          value={list.initial || list.error ? "—" : String(arrived)}
          hint="checked in or in the chair"
          icon={CheckCircle2}
          tone="success"
        />
        <StatTile
          label="Still to come"
          value={list.initial || list.error ? "—" : String(Math.max(0, rows.length - arrived))}
          hint="yet to reach the desk"
          icon={Clock3}
          tone="accent"
        />
      </div>

      {actionError && <ErrorNote error={actionError} />}

      {/* The desk is the only role that may move a booking to another stylist,
          so the request queue is theirs. A therapist sees the run sheet below. */}
      {role !== "EMPLOYEE" && <NewRequests onChanged={list.reload} />}

      {list.error ? (
        list.error.code === "EMPLOYEE_NOT_LINKED" ? (
          <UnlinkedAccount onRetry={list.reload} />
        ) : (
          <ErrorNote error={list.error} onRetry={list.reload} />
        )
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
          <Link to="/app/arrivals" className="font-medium text-primary hover:underline">
            Arrivals
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
