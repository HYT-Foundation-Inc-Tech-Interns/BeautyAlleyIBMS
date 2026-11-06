"use client";

/**
 * Move an appointment.
 *
 * Shared by the client's own list and the arrival pass: both ask the same
 * question of the same endpoint, and a guest holding the pass link must be able
 * to move the booking as well as cancel it. Keeping one dialog means the
 * "no open times" copy, the slot grid and the server error cannot drift between
 * the two surfaces.
 */

import * as React from "react";
import { CalendarClock, Loader2 } from "lucide-react";

import { branchDayKey, branchTime, branchToday, cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent } from "@/components/ui/modal";
import { ErrorNote, Loading } from "@/components/app/api-bits";
import type { Booking } from "@/lib/api-types";

export function RescheduleDialog({
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

