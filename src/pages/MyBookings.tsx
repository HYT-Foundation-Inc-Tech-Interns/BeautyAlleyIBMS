"use client";

/**
 * A client's own appointments.
 *
 * Reads `/me/bookings`, which resolves the caller's `clientId` from their
 * profile — so there is no client id in the request and nothing to tamper
 * with. An account with no linked client row gets an empty list rather than an
 * error, which is the correct answer: they have no bookings.
 */

import * as React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  Loader2,
  QrCode,
  UserRound,
  XCircle,
} from "lucide-react";

import {
  branchDay,
  branchDayKey,
  branchLongDay,
  branchTime,
  branchToday,
  cn,
  peso,
  relativeToNow,
} from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent } from "@/components/ui/modal";
import { EmptyNote, ErrorNote, Loading, StatusBadge } from "@/components/app/api-bits";
import { PageHeader, Panel } from "@/components/app/bits";
import type { Booking, BookingStatus } from "@/lib/api-types";

type Tab = "upcoming" | "past" | "all";

const TABS: { id: Tab; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "History" },
  { id: "all", label: "Everything" },
];

/** Which bookings are still ahead of us. */
const LIVE: BookingStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN", "IN_SERVICE"];

function RescheduleDialog({
  booking,
  onClose,
  onDone,
}: {
  booking: Booking;
  onClose: () => void;
  onDone: (updated: Booking) => void;
}) {
  const [date, setDate] = React.useState(() => branchDayKey(booking.startTime));
  const [picked, setPicked] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);

  const slots = useAsync(`move:${booking.id}:${date}`, async () => {
    const serviceId = booking.serviceIds?.[0] ?? booking.items[0]?.serviceId;
    if (!serviceId) return [];
    const data = await api.availability({
      serviceId,
      date,
      employeeId: booking.employee.id,
      intervalMinutes: 30,
    });
    return data.employees.find((e) => e.employeeId === booking.employee.id)?.slots ?? [];
  });

  async function move() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.bookings.reschedule(booking.id, picked);
      onDone(updated);
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not move the appointment"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        title="Move your appointment"
        description={`${booking.employee.fullName} · ${booking.reference}`}
      >
        <div className="p-6">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              New date
            </span>
            <input
              type="date"
              min={branchToday()}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setPicked(null);
              }}
              className="mt-1.5 block h-10 w-full rounded-lg border border-border bg-card px-3 text-[13.5px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            />
          </label>

          <div className="mt-4">
            {slots.initial ? (
              <Loading label="Checking the diary…" />
            ) : slots.error ? (
              <ErrorNote error={slots.error} onRetry={slots.reload} />
            ) : (slots.data?.length ?? 0) === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted-foreground">
                {booking.employee.fullName} has no open times on this day. Try another date.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slots.data!.map((slot) => (
                  <button
                    key={slot.start}
                    type="button"
                    onClick={() => setPicked(slot.start)}
                    aria-pressed={picked === slot.start}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-[12.5px] font-medium transition-colors",
                      picked === slot.start
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card hover:border-primary/40",
                    )}
                  >
                    {branchTime(slot.start)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <ErrorNote error={error} className="mt-4" />}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={move} disabled={!picked || busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
              {busy ? "Moving…" : "Move appointment"}
            </Button>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Keep it
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}

function CancelDialog({
  booking,
  windowHours,
  onClose,
  onDone,
}: {
  booking: Booking;
  windowHours: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.bookings.cancel(booking.id, { reason: reason.trim() || undefined });
      onDone(`Cancelled ${booking.reference}. Your pass no longer works.`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not cancel the appointment"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        title="Cancel this appointment?"
        description={`${branchDay(booking.startTime)} at ${branchTime(booking.startTime)} · ${booking.reference}`}
      >
        <div className="p-6">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Cancelling frees the chair for someone else and revokes the arrival pass. It is free up
            to {windowHours} hours before the appointment; inside that window the desk has to make
            the call.
          </p>

          <label className="mt-4 block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Reason (optional)
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Something came up."
              className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13.5px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            />
          </label>

          {error && <ErrorNote error={error} className="mt-4" />}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="destructive" onClick={cancel} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
              {busy ? "Cancelling…" : "Cancel appointment"}
            </Button>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Keep it
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}

export default function MyBookings() {
  const [tab, setTab] = React.useState<Tab>("upcoming");
  const [dialog, setDialog] = React.useState<{ kind: "move" | "cancel"; booking: Booking } | null>(
    null,
  );
  const [notice, setNotice] = React.useState<string | null>(null);
  // The row the server just returned from a reschedule. Rendering it straight
  // away avoids the second where the notice says 10:30 and the card still says
  // 9:00, waiting for the list refetch.
  const [moved, setMoved] = React.useState<Booking | null>(null);

  // Public policy, so the sentence under the list cannot disagree with the
  // server's cancellation rule.
  const policy = useAsync("public:booking-policy", () => api.settings.publicBooking());

  const list = useAsync(`mine:${tab}`, async () => {
    const page = await api.bookings.mine({
      limit: 100,
      ...(tab === "upcoming" ? { upcoming: true } : {}),
    });
    if (tab === "all") return page.data;
    const now = Date.now();
    return page.data.filter((b) => {
      const ahead = new Date(b.startTime).getTime() >= now;
      return tab === "upcoming" ? ahead || LIVE.includes(b.status) : !ahead;
    });
  });

  const rows = (list.data ?? []).map((b) => (b.id === moved?.id ? moved : b));

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-7">
      <PageHeader
        eyebrow="Your account"
        icon={CalendarDays}
        title="My bookings"
        description="Every appointment on your record, with the arrival pass for each. Passes can be re-opened at any time — the code is re-issued, never reused."
        actions={
          <Button asChild>
            <Link to="/book">
              <CalendarPlus className="size-4" />
              Book a service
            </Link>
          </Button>
        }
      />

      {notice && (
        <div className="flex items-start gap-2.5 rounded-xl border border-success/25 bg-success/[0.06] px-4 py-3 text-[12.5px] leading-relaxed text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          {notice}
        </div>
      )}

      <Panel className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex rounded-full border border-border bg-background p-0.5">
          {TABS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTab(option.id)}
              aria-pressed={tab === option.id}
              className={cn(
                "rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors",
                tab === option.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <span className="ml-auto text-[12.5px] text-muted-foreground">
          {list.initial
            ? "Reading your record…"
            : `${rows.length} appointment${rows.length === 1 ? "" : "s"}`}
        </span>
      </Panel>

      {list.error ? (
        <ErrorNote error={list.error} onRetry={list.reload} />
      ) : list.initial ? (
        <Loading label="Fetching your appointments…" />
      ) : rows.length === 0 ? (
        <EmptyNote
          icon={CalendarPlus}
          title={tab === "past" ? "No past visits yet" : "Nothing booked"}
          description={
            tab === "past"
              ? "Once you've been in, your visit history appears here."
              : "You have no upcoming appointments. Pick a treatment and we'll hold a chair."
          }
          action={
            <Button asChild>
              <Link to="/book">Browse services</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((booking) => {
            const live = LIVE.includes(booking.status);
            const movable =
              (booking.status === "PENDING" || booking.status === "CONFIRMED") &&
              new Date(booking.startTime).getTime() > Date.now();
            return (
              <li
                key={booking.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-border/80 bg-card p-5 shadow-soft"
              >
                <div className="flex min-w-[86px] flex-col rounded-lg bg-sand-50 px-3.5 py-2.5 text-center">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {branchDay(booking.startTime)}
                  </span>
                  <span className="mt-0.5 font-display text-[17px] font-semibold leading-none">
                    {branchTime(booking.startTime)}
                  </span>
                </div>

                <div className="min-w-[180px] flex-1">
                  <p className="font-display text-[17px] font-semibold leading-tight tracking-tight">
                    {booking.items.map((item) => item.name).join(", ") || booking.reference}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="size-3" />
                      {booking.employee.fullName}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="size-3" />
                      {relativeToNow(booking.startTime)}
                    </span>
                    <span className="font-mono text-[11px]">{booking.reference}</span>
                  </p>
                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    {branchLongDay(booking.startTime)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-right">
                    <span className="block font-display text-[18px] font-semibold text-primary">
                      {peso(booking.totalCents)}
                    </span>
                    {booking.discountCents > 0 && (
                      <span className="block text-[11px] text-primary">
                        {peso(booking.discountCents)} off
                      </span>
                    )}
                  </span>
                  <StatusBadge status={booking.status} />
                  {live && (
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/pass/${booking.id}`}>
                        <QrCode className="size-3.5" />
                        Pass
                      </Link>
                    </Button>
                  )}
                  {movable && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ kind: "move", booking })}
                      >
                        <CalendarClock className="size-3.5" />
                        Move
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => setDialog({ kind: "cancel", booking })}
                      >
                        <XCircle className="size-3.5" />
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-xl border border-border/80 bg-sand-50 px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Cancelling or moving is free up to{" "}
          <span className="font-medium text-foreground">
            {policy.data?.cancellationWindowHours ?? 2} hours
          </span>{" "}
          before your appointment. Inside that window, call the salon and the desk can help. Your
          pass lives on the booking's own page — open it from here when you need it.
        </p>
      </div>

      <p className="text-center text-[12px] text-muted-foreground">
        <ArrowRight className="mr-1 inline size-3.5" />
        Looking for something new?{" "}
        <Link to="/services" className="font-medium text-primary hover:underline">
          Browse the full menu
        </Link>
      </p>

      {dialog?.kind === "move" && (
        <RescheduleDialog
          booking={dialog.booking}
          onClose={() => setDialog(null)}
          onDone={(updated) => {
            setDialog(null);
            setMoved(updated);
            setNotice(
              `Moved to ${branchDay(updated.startTime)} at ${branchTime(updated.startTime)}.`,
            );
            list.reload();
          }}
        />
      )}
      {dialog?.kind === "cancel" && (
        <CancelDialog
          booking={dialog.booking}
          windowHours={policy.data?.cancellationWindowHours ?? 2}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            setNotice(message);
            list.reload();
          }}
        />
      )}
    </div>
  );
}
