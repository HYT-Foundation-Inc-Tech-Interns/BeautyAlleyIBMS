"use client";

/**
 * The one exception to the arrival window, made visible.
 *
 * A pass opens shortly before its appointment. A guest who turns up before that
 * is not refused because the salon doubts them — the check-in record is what
 * the day is built on, and an arrival time that is hours early is not an
 * arrival time. But the desk is the judge of the exception: somebody who came
 * straight from the airport, or a quiet afternoon with a free chair.
 *
 * So the override exists, and this dialog is where it is spent. It says what is
 * about to happen, who it will be attributed to, and what is *not* on offer —
 * a late arrival is a no-show, not an early check-in.
 */

import * as React from "react";
import { Clock3, Loader2 } from "lucide-react";

import { branchDay, branchTime } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import type { Booking, CheckInResult } from "@/lib/api-types";
import { checkInBooking } from "@/lib/check-in";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent } from "@/components/ui/modal";
import { ErrorNote } from "@/components/app/api-bits";

export function EarlyArrivalDialog({
  booking,
  onClose,
  onDone,
}: {
  booking: Booking;
  onClose: () => void;
  /** Receives the redemption, so the caller can show when it was recorded. */
  onDone: (result: CheckInResult) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);

  const who = booking.client?.fullName ?? booking.guest?.name ?? "Guest booking";

  async function admit() {
    setBusy(true);
    setError(null);
    try {
      onDone(await checkInBooking(booking.id, { force: true }));
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not check that guest in"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        title="Admit early"
        description={`Admit ${booking.reference} before its pass opens`}
      >
        <div className="p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-champagne-400/20 text-champagne-600">
              <Clock3 className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-[19px] font-semibold tracking-tight">
                This guest is early.
              </h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                {who} · {branchDay(booking.startTime)} at {branchTime(booking.startTime)} ·{" "}
                <span className="font-mono text-[11px]">{booking.reference}</span>
              </p>
            </div>
          </div>

          <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
            The pass opens shortly before the appointment. Admitting them now
            records the arrival at the time it actually happened, and marks the
            check-in as an override in the audit trail — against your account.
          </p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground/80">
            A guest arriving after the appointment has ended is a no-show, not
            an early arrival; that is not what this does.
          </p>

          {error && <ErrorNote error={error} className="mt-4" />}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="champagne" onClick={admit} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Clock3 />}
              {busy ? "Admitting…" : "Admit anyway"}
            </Button>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Wait until then
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
