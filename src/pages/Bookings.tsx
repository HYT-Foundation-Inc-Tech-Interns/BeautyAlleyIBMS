"use client";

/**
 * The bookings record.
 *
 * This is the operational heart of the console and it serves every working
 * role from one page — but not with the same rows. `GET /bookings` gives the
 * desk and the owner the whole branch and gives an employee only their own
 * chair; the API applies that scope from the token, so this page cannot widen
 * it by asking. What is left for the screen to decide is the wording ("Your
 * bookings") and which actions to offer: status changes are `OPERATIONS`,
 * while reassigning the room is `DESK` and never shown to the floor.
 *
 * The status buttons are generated from `NEXT_STATUS`, which mirrors the
 * database trigger's state machine. Offering only legal transitions means the
 * UI cannot produce a request the database will reject — the alternative is a
 * row of buttons where most of them return `INVALID_STATUS_TRANSITION`.
 */

import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";

import { branchDay, branchTime, branchToday, cn, peso, shiftDayKey } from "@/lib/utils";
import { api, ApiError, NEXT_STATUS, STATUS_ACTION, STATUS_LABEL } from "@/lib/api";
import { checkInBooking, isEarlyArrival } from "@/lib/check-in";
import { useAuth } from "@/auth/AuthProvider";
import { useAsync } from "@/lib/useAsync";
import type { Booking, BookingStatus } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent } from "@/components/ui/modal";
import { PageHeader } from "@/components/app/bits";
import { ClientAccountDialog } from "@/components/app/client-account-dialog";
import { EarlyArrivalDialog } from "@/components/app/early-arrival-dialog";
import { EmptyNote, ErrorNote, Loading, PersonAvatar, StatusBadge } from "@/components/app/api-bits";

const STATUSES: BookingStatus[] = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_SERVICE",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

type Range = "today" | "upcoming" | "past" | "all";

const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Next 7 days" },
  { id: "past", label: "Last 7 days" },
  { id: "all", label: "All time" },
];

function rangeBounds(range: Range): { from?: string; to?: string } {
  const today = branchToday();
  switch (range) {
    case "today":
      return { from: today, to: today };
    case "upcoming":
      return { from: today, to: shiftDayKey(today, 7) };
    case "past":
      return { from: shiftDayKey(today, -7), to: today };
    default:
      return {};
  }
}

function useDebounced<T>(value: T, ms = 300) {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export default function Bookings() {
  /*
   * The administrator's copy of this page is a record: read it, and change a
   * booking's state or room. Creating one is the desk's job — the person at the
   * counter with the guest — so the button is not offered here.
   */
  const { role } = useAuth();
  /* The floor reads its own chair; the API decides that, this only names it. */
  const isFloor = role === "EMPLOYEE";
  const canCreate = role === "CONCIERGE";
  /* The desk and the owner can open a client login; the floor cannot. */
  const canCreateClient = role === "CONCIERGE" || role === "ADMIN";
  /*
   * Cancelling a guest's appointment is the desk's act — the person the guest
   * is standing in front of, or on the phone — and the owner's, who answers
   * for the same bookings. The floor keeps the status moves for their own
   * chair; it does not cancel work out from under the desk.
   */
  const canCancel = role === "CONCIERGE" || role === "ADMIN";
  /*
   * Seeded from the URL once, on mount, so another page can hand this one a
   * question instead of a bare page: `/app/bookings?range=all&q=BA-1A2B` opens
   * on that booking. Only the first read is taken — after that the controls own
   * the state, because a URL that keeps overwriting what you type is worse than
   * one that is a moment out of date.
   */
  const [params] = useSearchParams();
  const seedRange = params.get("range");
  const seedStatus = params.get("status");

  const [range, setRange] = React.useState<Range>(() =>
    RANGES.some((r) => r.id === seedRange) ? (seedRange as Range) : "upcoming",
  );
  const [status, setStatus] = React.useState<BookingStatus | "">(() =>
    STATUSES.includes(seedStatus as BookingStatus) ? (seedStatus as BookingStatus) : "",
  );
  const [term, setTerm] = React.useState(() => params.get("q") ?? "");
  const [page, setPage] = React.useState(1);
  const q = useDebounced(term);

  // Any filter change invalidates the current page number.
  React.useEffect(() => {
    setPage(1);
  }, [range, status, q]);

  const bounds = rangeBounds(range);

  const list = useAsync(
    `bookings:${range}:${status}:${q}:${page}`,
    () =>
      api.bookings.list({
        page,
        limit: 20,
        sort: "start_time",
        order: range === "past" ? "desc" : "asc",
        ...bounds,
        ...(status ? { status } : {}),
        ...(q.trim() ? { q: q.trim() } : {}),
      }),
  );

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<ApiError | null>(null);
  /* The booking the desk has asked to end, held until the dialog closes. */
  const [endTarget, setEndTarget] = React.useState<Booking | null>(null);
  /* A guest who arrived before their pass opened, held for the override. */
  const [earlyTarget, setEarlyTarget] = React.useState<Booking | null>(null);

  async function advance(booking: Booking, next: BookingStatus) {
    setBusyId(booking.id);
    setActionError(null);
    try {
      // Check-in goes through the pass, not a status write — see lib/check-in.
      if (next === "CHECKED_IN") await checkInBooking(booking.id);
      else await api.bookings.setStatus(booking.id, next);
      list.reload();
    } catch (err) {
      // Early arrival is not a failure — it is a question for the desk.
      if (isEarlyArrival(err)) setEarlyTarget(booking);
      else
        setActionError(
          err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not move that booking"),
        );
    } finally {
      setBusyId(null);
    }
  }

  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;
  const filtersActive = Boolean(q.trim() || status);

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-7">
      <PageHeader
        eyebrow={isFloor ? "Your chair" : "Records"}
        icon={CalendarDays}
        title={isFloor ? "Your bookings" : "Bookings"}
        description={
          isFloor
            ? "The guests booked with you, in the order you will see them. The desk and the owner read every chair; you read yours."
            : "Every reservation, across every chair. Status changes here are the same ones the database enforces — only legal moves are offered."
        }
        actions={
          <>
            <Button variant="outline" size="icon" aria-label="Refresh" onClick={list.reload}>
              <RefreshCw className="size-4" />
            </Button>
            {/* The desk can make a client login here, without leaving the page
                it already works on. Staff accounts stay with the administrator. */}
            {canCreateClient && <ClientAccountDialog onChanged={() => list.reload()} />}
            {canCreate && (
              <Button asChild>
                <Link to="/app/bookings/new">
                  <Plus className="size-4" />
                  New booking
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/* ------------------------------------------------------- filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card p-3.5 shadow-soft">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Client name, phone, email, or reference…"
            aria-label="Search bookings"
            className="h-9 w-full rounded-full border border-border bg-background pl-10 pr-3 text-[13px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
          />
        </div>

        <div className="flex rounded-full border border-border bg-background p-0.5">
          {RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setRange(option.id)}
              aria-pressed={range === option.id}
              className={cn(
                "rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                range === option.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Filter className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as BookingStatus | "")}
            aria-label="Filter by status"
            className="h-9 appearance-none rounded-full border border-border bg-background pl-8 pr-8 text-[12.5px] outline-none focus:border-primary/50"
          >
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>

        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTerm("");
              setStatus("");
            }}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}

        <span className="ml-auto text-[12.5px] text-muted-foreground">
          {meta ? `${meta.total} result${meta.total === 1 ? "" : "s"}` : ""}
        </span>
      </div>

      {actionError && <ErrorNote error={actionError} />}

      {/* --------------------------------------------------------- records */}
      {list.error ? (
        <ErrorNote error={list.error} onRetry={list.reload} />
      ) : list.initial ? (
        <Loading label="Fetching bookings…" />
      ) : rows.length === 0 ? (
        <EmptyNote
          icon={CalendarDays}
          title="No bookings match"
          description={
            q.trim() && range !== "all"
              ? `Nothing in this window matches "${q.trim()}". The client may only have bookings outside it.`
              : filtersActive
                ? "Try a wider date range, or clear the filters."
                : isFloor
                  ? "Nothing is on your chair in this window yet."
                  : "Nothing has been booked in this window yet."
          }
          action={
            // A name typed into the bar is usually a question about a person,
            // not about this week — so the first thing offered is the same
            // search across every date, rather than clearing what was typed.
            q.trim() && range !== "all" ? (
              <Button variant="outline" onClick={() => setRange("all")}>
                Search all dates
              </Button>
            ) : filtersActive ? (
              <Button
                variant="outline"
                onClick={() => {
                  setTerm("");
                  setStatus("");
                  setRange("all");
                }}
              >
                Show everything
              </Button>
            ) : canCreate ? (
              /* The desk books; the floor reads. An employee with an empty
                 chair gets the sentence, not a door into the public form. */
              <Button asChild>
                <Link to="/book">Create a booking</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        /*
         * Cards, not a table. The console's home page already reads as a stack
         * of appointment cards, and the same row is the right shape here: a
         * table forced six columns into 900px, which pushed the reference and
         * the treatment into each other on a laptop. The card wraps instead of
         * overflowing, and a row means the same thing on both pages.
         */
        <ol className="space-y-3">
          {rows.map((booking) => {
            const who = booking.client?.fullName ?? booking.guest?.name ?? "Guest booking";
            const next = NEXT_STATUS[booking.status];
            /*
             * The row moves a booking forward. Everything that *ends* one —
             * cancel and no-show — is behind a single control, because they
             * are the same decision with two answers and side by side they
             * read as two equally safe buttons next to the one that is safe.
             *
             * CANCELLED is filtered out for every role, not just the desk: as
             * a raw status move it skipped the reason, the cancellation time
             * and the pass revocation that POST /cancel writes. No-show is
             * only offered while the guest is still expected; once they are in
             * the chair, being absent is not a move this row offers.
             */
            const allMoves: BookingStatus[] = next;
            const moves = allMoves.filter((s) => s !== "CANCELLED" && s !== "NO_SHOW");
            const visible = moves.slice(0, 2);
            const canNoShow =
              (booking.status === "PENDING" || booking.status === "CONFIRMED") &&
              next.includes("NO_SHOW");
            return (
              <li
                key={booking.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-border/70 bg-card p-5 shadow-soft transition-[border-color,box-shadow,transform] duration-300 ease-out-quart hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lift"
              >
                <span className="flex min-w-[70px] flex-col rounded-lg bg-sand-50 px-3 py-2 text-center">
                  <span className="font-display text-[16px] font-semibold leading-none tabular-nums">
                    {branchTime(booking.startTime)}
                  </span>
                  <span className="mt-1 text-[10px] text-muted-foreground">
                    {branchDay(booking.startTime)}
                  </span>
                </span>

                <PersonAvatar name={who} className="size-10 shrink-0" />

                <div className="min-w-[190px] flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <p className="font-display text-[17px] font-semibold leading-tight tracking-tight">
                      {who}
                    </p>
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      {booking.reference}
                    </span>
                  </div>
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

                <div className="shrink-0 text-right">
                  <p className="text-[13px] font-medium tabular-nums">
                    {peso(booking.totalCents)}
                  </p>
                  {booking.discountCents > 0 && (
                    <p className="text-[10.5px] text-primary">
                      −{peso(booking.discountCents)}
                    </p>
                  )}
                </div>

                <StatusBadge status={booking.status} />

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {visible.length === 0 ? (
                    <span className="text-[11.5px] text-muted-foreground">Settled</span>
                  ) : (
                    visible.map((s, index) => (
                        <Button
                          key={s}
                          size="sm"
                          // The forward move is the loud one, as on the run
                          // sheet: two identical buttons make the desk read
                          // both before choosing, which is the cost this list
                          // exists to avoid.
                          variant={index === 0 ? "default" : "outline"}
                          disabled={busyId === booking.id}
                          onClick={() => advance(booking, s)}
                        >
                          {STATUS_ACTION[s]}
                        </Button>
                      ))
                  )}
                  {(canCancel || canNoShow) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-clay hover:bg-clay/10"
                      onClick={() => setEndTarget(booking)}
                    >
                      End booking…
                    </Button>
                  )}
                  {booking.client === null && booking.status !== "CANCELLED" && (
                    <Button asChild size="sm" variant="ghost">
                      <Link to={`/pass/${booking.id}`}>Pass</Link>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

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

      {endTarget && (
        <EndBookingDialog
          booking={endTarget}
          canCancel={canCancel && NEXT_STATUS[endTarget.status].includes("CANCELLED")}
          canNoShow={
            (endTarget.status === "PENDING" || endTarget.status === "CONFIRMED") &&
            NEXT_STATUS[endTarget.status].includes("NO_SHOW")
          }
          onClose={() => setEndTarget(null)}
          onDone={() => {
            setEndTarget(null);
            list.reload();
          }}
        />
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border/80 bg-card px-5 py-3.5 shadow-soft">
          <p className="text-[12px] text-muted-foreground">
            Page {meta.page} of {meta.totalPages} · {meta.total} bookings
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!meta.hasPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-3.5" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!meta.hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The desk's ending
 * ------------------------------------------------------------------ */

/**
 * Ending a booking, with the two answers that end one.
 *
 * Cancel and no-show were two ghost buttons on the row, and side by side they
 * looked like one decision split in two: the desk had to read both every time
 * to find the one that applied. They are also different records — a
 * cancellation takes a reason and revokes the pass through POST /cancel,
 * while a no-show is a status move that says the guest never turned up — so
 * the dialog asks which happened and then shows only the field that answer
 * needs.
 *
 * Neither is offered unless the state machine allows it, so the dialog cannot
 * be the way around a rule the row already honours.
 */
function EndBookingDialog({
  booking,
  canCancel,
  canNoShow,
  onClose,
  onDone,
}: {
  booking: Booking;
  canCancel: boolean;
  canNoShow: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = React.useState<"cancel" | "noshow">(canCancel ? "cancel" : "noshow");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);

  const who = booking.client?.fullName ?? booking.guest?.name ?? "Guest booking";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "cancel") {
        await api.bookings.cancel(booking.id, { reason: reason.trim() || undefined, force: true });
      } else {
        await api.bookings.setStatus(booking.id, "NO_SHOW");
      }
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError(0, "UNKNOWN", "Could not end that booking"),
      );
    } finally {
      setBusy(false);
    }
  }

  const choices = [
    {
      id: "cancel" as const,
      label: "The guest cancelled",
      note: "Stays on record as cancelled, with the reason, and their pass stops working.",
      allowed: canCancel,
    },
    {
      id: "noshow" as const,
      label: "The guest never arrived",
      note: "Marks a no-show. Nothing was delivered and nothing is owed.",
      allowed: canNoShow,
    },
  ].filter((choice) => choice.allowed);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent title="End booking" description={`End ${booking.reference}`}>
        <div className="p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-clay/10 text-clay">
              <TriangleAlert className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-[19px] font-semibold tracking-tight">
                How did this booking end?
              </h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                {who} · {branchDay(booking.startTime)} at {branchTime(booking.startTime)} ·{" "}
                <span className="font-mono text-[11px]">{booking.reference}</span>
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {choices.map((choice) => {
              const active = mode === choice.id;
              return (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => setMode(choice.id)}
                  aria-pressed={active}
                  disabled={busy}
                  className={cn(
                    "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                    active
                      ? "border-clay/50 bg-clay/[0.06]"
                      : "border-border bg-card hover:border-clay/30",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                        active ? "border-clay" : "border-border",
                      )}
                    >
                      {active && <span className="size-1.5 rounded-full bg-clay" />}
                    </span>
                    <span className="text-[13px] font-medium">{choice.label}</span>
                  </span>
                  <span className="mt-1 block pl-[22px] text-[11.5px] leading-relaxed text-muted-foreground">
                    {choice.note}
                  </span>
                </button>
              );
            })}
          </div>

          {mode === "cancel" && (
            <label className="mt-4 block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Reason (optional)
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Guest called to cancel…"
                className="mt-1.5 w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              />
            </label>
          )}

          <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
            {mode === "cancel"
              ? "The desk may cancel inside the two-hour window; the booking stays on record either way."
              : "A no-show is not a cancellation: it keeps the appointment on the record and frees the chair."}
          </p>

          {error && <ErrorNote error={error} className="mt-4" />}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="destructive" onClick={submit} disabled={busy}>
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : mode === "cancel" ? (
                <X />
              ) : (
                <TriangleAlert />
              )}
              {busy
                ? "Ending…"
                : mode === "cancel"
                  ? "Cancel booking"
                  : "Mark no-show"}
            </Button>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Keep booking
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
