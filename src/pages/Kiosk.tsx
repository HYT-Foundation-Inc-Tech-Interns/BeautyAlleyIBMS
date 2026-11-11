"use client";

/**
 * The screen by the door.
 *
 * Three things make this page different from every other one in the app, and
 * each is deliberate:
 *
 * 1. **It has no session.** It is not behind `RequireAuth` and it never calls
 *    `/auth/me`. Its credential is a device token, read out of the URL
 *    fragment on first boot and kept on the tablet (see `lib/kiosk-device.ts`).
 *    A staff session in the same browser is irrelevant: the API refuses one on
 *    these routes, and every call here names the device token explicitly.
 *
 * 2. **It shows a guest's name, so it must stop showing it.** Every screen that
 *    ends an interaction returns to the scanner on a timer. A card left up is
 *    the next guest reading somebody else's appointment.
 *
 * 3. **It is read standing up, at arm's length, by someone who has never used
 *    it.** Type is larger than the console's, the keypad is the only input, and
 *    nothing depends on a hover state.
 *
 * The flow is: scan a pass → the guest card → a stylist's PIN → admitted. The
 * server re-checks everything on admission; the card's "blocked" sentence is a
 * prediction, so the button failing is still handled.
 */

import * as React from "react";
import {
  BadgeCheck,
  Camera,
  Delete,
  Loader2,
  ScanLine,
  ShieldAlert,
  TriangleAlert,
  UserRound,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import type { KioskArrival, KioskBlocker, KioskIdentity } from "@/lib/api-types";
import { adoptDeviceToken, forgetDeviceToken, readDeviceToken } from "@/lib/kiosk-device";
import { branchTime, cn } from "@/lib/utils";
import { CameraScanner } from "@/components/app/camera-scanner";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

/** Why a PIN was refused, in the terms the pad needs. */
type PinFailure =
  | { kind: "wrong"; attemptsLeft: number }
  | { kind: "locked"; retryAfterSeconds: number }
  | { kind: "inactive" }
  | { kind: "failed"; message: string };

type Screen =
  | { kind: "connecting" }
  | { kind: "offline"; title: string; message: string }
  | { kind: "scan"; notice: string | null }
  | { kind: "reading" }
  | { kind: "arrival"; pass: string; arrival: KioskArrival; failure: PinFailure | null }
  | { kind: "admitting"; pass: string; arrival: KioskArrival }
  | { kind: "admitted"; arrival: KioskArrival; staffName: string }
  | { kind: "problem"; title: string; message: string };

/**
 * How long each finished screen stays up before the scanner comes back.
 *
 * A celebration gets long enough to read; a failure gets long enough to
 * understand; a blocked guest gets longest, because they are the one who has
 * to walk to the desk and may want to point at the screen.
 */
function dwellFor(screen: Screen): number {
  if (screen.kind === "admitted") return 12_000;
  if (screen.kind === "problem") return 9_000;
  if (screen.kind === "arrival" && screen.arrival.blocked) return 20_000;
  return 0;
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function Kiosk() {
  // Read once, before the first render: `adoptDeviceToken` also strips the
  // token out of the address bar, and doing that in an effect would leave it
  // visible for a frame.
  const [token] = React.useState(() => adoptDeviceToken() ?? readDeviceToken());

  if (!token) return <NotSetUp />;
  return <DoorScreen token={token} />;
}

/* ------------------------------------------------------------------ *
 * Not provisioned
 * ------------------------------------------------------------------ */

function NotSetUp() {
  return (
    <Frame label={null}>
      <Panel>
        <span className="flex size-14 items-center justify-center rounded-full bg-champagne-400/15 text-champagne-300">
          <ShieldAlert className="size-6" />
        </span>
        <h1 className="mt-6 font-display text-[clamp(1.5rem,4vw,2rem)] font-medium leading-tight tracking-tight">
          This screen is not set up
        </h1>
        <p className="mt-3 max-w-md text-[14px] leading-relaxed text-primary-foreground/60">
          It needs a door link from the owner before it can admit anyone. Open
          the link on this tablet, once, and it will remember.
        </p>
      </Panel>
    </Frame>
  );
}

/* ------------------------------------------------------------------ *
 * The machine
 * ------------------------------------------------------------------ */

function DoorScreen({ token }: { token: string }) {
  const [screen, setScreen] = React.useState<Screen>({ kind: "connecting" });
  const [device, setDevice] = React.useState<KioskIdentity | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  /* --- boot: does this token still work? ---------------------------- */
  React.useEffect(() => {
    let live = true;
    setScreen({ kind: "connecting" });

    api.kiosk
      .me(token)
      .then((identity) => {
        if (!live) return;
        setDevice(identity);
        setScreen({ kind: "scan", notice: null });
      })
      .catch((err: unknown) => {
        if (!live) return;
        const e = asApiError(err);
        // A token the API does not recognise can never work again, so it is
        // discarded: on the next reload the screen says "not set up", which is
        // the instruction whoever finds the tablet actually needs.
        if (e.code === "KIOSK_TOKEN_INVALID") forgetDeviceToken();
        setScreen(offlineFrom(e));
      });

    return () => {
      live = false;
    };
  }, [token, attempt]);

  /* --- return to the scanner after a finished screen ---------------- */
  const dwell = dwellFor(screen);
  React.useEffect(() => {
    if (!dwell) return;
    const timer = window.setTimeout(() => setScreen({ kind: "scan", notice: null }), dwell);
    return () => window.clearTimeout(timer);
  }, [dwell, screen]);

  /* --- a pass was read ---------------------------------------------- */
  async function read(raw: string) {
    // The camera fires on every decoded frame. Once a card is up the scanner is
    // paused, but a frame already in flight can still arrive here.
    if (screen.kind !== "scan") return;
    setScreen({ kind: "reading" });

    try {
      const arrival = await api.kiosk.lookup(token, raw);
      setScreen({ kind: "arrival", pass: raw, arrival, failure: null });
    } catch (err) {
      const e = asApiError(err);
      if (e.code === "QR_EXPIRED") {
        setScreen({
          kind: "problem",
          title: "This pass has expired",
          message: "The front desk can still check you in. Please see them.",
        });
      } else if (e.code === "QR_INVALID") {
        setScreen({
          kind: "problem",
          title: "That code was not recognised",
          message: "Hold the pass steady inside the frame, or ask at the front desk.",
        });
      } else if (e.code === "KIOSK_REVOKED" || e.code === "KIOSK_TOKEN_INVALID") {
        setScreen(offlineFrom(e));
      } else {
        setScreen({ kind: "problem", title: "The door could not read that pass", message: e.message });
      }
    }
  }

  /* --- a PIN was entered -------------------------------------------- */
  async function admit(pin: string) {
    if (screen.kind !== "arrival") return;
    const { pass, arrival } = screen;
    setScreen({ kind: "admitting", pass, arrival });

    try {
      const result = await api.kiosk.checkIn(token, pass, pin);
      setScreen({ kind: "admitted", arrival, staffName: result.staffName });
    } catch (err) {
      const e = asApiError(err);
      const failure = pinFailure(e);

      if (failure) {
        setScreen({ kind: "arrival", pass, arrival, failure });
      } else if (e.code === "ALREADY_CHECKED_IN") {
        setScreen({
          kind: "problem",
          title: "That pass has already been used",
          message: "Somebody has already checked this guest in.",
        });
      } else if (e.code === "KIOSK_REVOKED" || e.code === "KIOSK_TOKEN_INVALID") {
        setScreen(offlineFrom(e));
      } else {
        setScreen({
          kind: "arrival",
          pass,
          arrival,
          failure: { kind: "failed", message: e.message },
        });
      }
    }
  }

  function reset() {
    setScreen({ kind: "scan", notice: null });
  }

  const scanning = screen.kind === "scan" || screen.kind === "reading";

  return (
    <Frame label={device?.label ?? null}>
      {screen.kind === "connecting" && (
        <Panel>
          <div className="flex items-center gap-3 text-[14px] text-primary-foreground/60">
            <Loader2 className="size-4 animate-spin" />
            Starting up…
          </div>
        </Panel>
      )}

      {screen.kind === "offline" && (
        <Panel>
          <span className="flex size-14 items-center justify-center rounded-full bg-clay/20 text-[#E4A48F]">
            <ShieldAlert className="size-6" />
          </span>
          <h1 className="mt-6 font-display text-[clamp(1.5rem,4vw,2rem)] font-medium leading-tight tracking-tight">
            {screen.title}
          </h1>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed text-primary-foreground/60">
            {screen.message}
          </p>
          <Button
            variant="outline"
            className="mt-7 border-white/20 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </Button>
        </Panel>
      )}

      {scanning && (
        <div>
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-champagne-300">
                Arrivals
              </p>
              <h1 className="mt-2 font-display text-[clamp(1.6rem,4.4vw,2.2rem)] font-medium leading-tight tracking-tight">
                Scan your arrival pass
              </h1>
            </div>
            <ScanLine className="mb-1 size-6 shrink-0 text-champagne-300/70" />
          </div>

          <div className="relative [--muted-foreground:152_22%_70%]">
            <CameraScanner
              onCode={(raw) => void read(raw)}
              paused={screen.kind !== "scan"}
              hint="Hold the code from your booking inside the frame. It is read automatically."
            />
            {screen.kind === "reading" && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-alley-950/70 backdrop-blur-sm">
                <span className="flex items-center gap-2.5 text-[13.5px] text-primary-foreground/80">
                  <Loader2 className="size-4 animate-spin" />
                  Reading your pass…
                </span>
              </div>
            )}
          </div>

          <PassBox onSubmit={(raw) => void read(raw)} disabled={screen.kind !== "scan"} />

          {screen.kind === "scan" && screen.notice && (
            <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[13px] leading-relaxed text-primary-foreground/70">
              {screen.notice}
            </p>
          )}
        </div>
      )}

      {(screen.kind === "arrival" || screen.kind === "admitting") && (
        <ArrivalCard
          arrival={screen.arrival}
          failure={screen.kind === "arrival" ? screen.failure : null}
          busy={screen.kind === "admitting"}
          onAdmit={admit}
          onDone={reset}
        />
      )}

      {screen.kind === "admitted" && (
        <Panel>
          <span className="flex size-16 items-center justify-center rounded-full bg-[#9FD3BC]/15 text-[#B9E3CE] ring-1 ring-[#9FD3BC]/30">
            <BadgeCheck className="size-8" />
          </span>
          <p className="mt-6 text-[10.5px] font-semibold uppercase tracking-[0.24em] text-champagne-300">
            Checked in
          </p>
          <h1 className="mt-2 font-display text-[clamp(1.6rem,4.2vw,2.2rem)] font-medium leading-tight tracking-tight">
            {greeting(screen.arrival.guestName, "Welcome in")}
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-primary-foreground/60">
            {screen.staffName} has you. Please take a seat and they will come and
            find you.
          </p>
          <p className="mt-6 text-[12px] text-primary-foreground/35">
            {branchTime(screen.arrival.startTime)} · {screen.arrival.reference}
          </p>
        </Panel>
      )}

      {screen.kind === "problem" && (
        <Panel>
          <span className="flex size-14 items-center justify-center rounded-full bg-champagne-400/15 text-champagne-300">
            <TriangleAlert className="size-6" />
          </span>
          <h1 className="mt-6 font-display text-[clamp(1.5rem,4vw,2rem)] font-medium leading-tight tracking-tight">
            {screen.title}
          </h1>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed text-primary-foreground/60">
            {screen.message}
          </p>
          <Button
            variant="outline"
            className="mt-7 border-white/20 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
            onClick={reset}
          >
            Scan another pass
          </Button>
        </Panel>
      )}
    </Frame>
  );
}

/* ------------------------------------------------------------------ *
 * The arrival card
 * ------------------------------------------------------------------ */

function ArrivalCard({
  arrival,
  failure,
  busy,
  onAdmit,
  onDone,
}: {
  arrival: KioskArrival;
  failure: PinFailure | null;
  busy: boolean;
  onAdmit: (pin: string) => void;
  onDone: () => void;
}) {
  const blocked = arrival.blocked;

  return (
    <Panel>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-champagne-300">
        {blocked ? "Not admitted" : "Arrival"}
      </p>
      <h1 className="mt-2 font-display text-[clamp(1.5rem,4vw,2.05rem)] font-medium leading-tight tracking-tight">
        {blocked
          ? blockedCopy(blocked, arrival).title
          : greeting(arrival.guestName)}
      </h1>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-primary-foreground/60">
        <span className="inline-flex items-center gap-2">
          <UserRound className="size-4 text-champagne-300/70" />
          {arrival.staffName ?? "Your stylist"}
        </span>
        <span className="tnum">
          {branchTime(arrival.startTime)} – {branchTime(arrival.endTime)}
        </span>
      </div>

      {arrival.services.length > 0 && (
        <p className="mt-2 text-[13.5px] leading-relaxed text-primary-foreground/45">
          {arrival.services.join(" · ")}
        </p>
      )}

      <div className="mt-5 h-px bg-white/10" />

      {blocked ? (
        <>
          <p className="mt-6 text-[14px] leading-relaxed text-primary-foreground/65">
            {blockedCopy(blocked, arrival).message}
          </p>
          <Button
            variant="outline"
            className="mt-7 border-white/20 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
            onClick={onDone}
          >
            Done
          </Button>
        </>
      ) : (
        <PinEntry failure={failure} busy={busy} onSubmit={onAdmit} onCancel={onDone} />
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * The keypad
 * ------------------------------------------------------------------ */

function PinEntry({
  failure,
  busy,
  onSubmit,
  onCancel,
}: {
  failure: PinFailure | null;
  busy: boolean;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const [digits, setDigits] = React.useState("");

  // A refusal is about the digits that were just typed, so they are cleared:
  // leaving them on screen invites the next attempt to append to a wrong PIN.
  React.useEffect(() => {
    if (failure) setDigits("");
  }, [failure]);

  /**
   * The lockout counts down on screen.
   *
   * The server says how long is left, but the screen has to keep working when
   * it elapses: the guest is standing there, and a pad that stays dead until
   * somebody presses Cancel is a pad they will press Cancel on.
   */
  const [secondsLeft, setSecondsLeft] = React.useState(0);
  React.useEffect(() => {
    if (failure?.kind !== "locked") {
      setSecondsLeft(0);
      return;
    }
    setSecondsLeft(failure.retryAfterSeconds);
    const timer = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [failure]);

  const locked = failure?.kind === "locked" && secondsLeft > 0;
  const inactive = failure?.kind === "inactive";
  const canType = !busy && !locked && !inactive;

  function press(digit: string) {
    if (!canType || digits.length >= 6) return;
    setDigits((d) => d + digit);
  }

  const ready = digits.length >= 4 && canType;

  return (
    <div className="mt-5">
      <p className="text-[13.5px] leading-relaxed text-primary-foreground/65">
        {locked
          ? "This screen has been paused after too many wrong PINs."
          : inactive
            ? "That PIN belongs to someone who is no longer active."
            : "Ask your stylist to enter their door PIN."}
      </p>

      {/* ------------------------------------------------------- slots */}
      <div className="mt-4 flex items-center gap-2" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "flex h-10 w-8 items-center justify-center rounded-lg border text-[18px] font-semibold tabular-nums transition-colors",
              i < digits.length
                ? "border-champagne-400/60 bg-champagne-400/15 text-champagne-200"
                : "border-white/10 bg-white/[0.03] text-transparent",
            )}
          >
            •
          </span>
        ))}
      </div>

      {/*
        * The refusal line holds its space whether or not there is a refusal.
        * Without that, a wrong PIN pushes the keypad down under the finger that
        * is about to press it again.
        */}
      <div className="mt-3 min-h-[1.5rem]">
        {failure && (
          <p
            role="status"
            className={cn(
              "text-[13.5px] leading-relaxed",
              failure.kind === "wrong" || failure.kind === "locked"
                ? "text-[#F0B7A3]"
                : "text-primary-foreground/65",
            )}
          >
            {failureCopy(failure, secondsLeft)}
          </p>
        )}
      </div>

      {/* -------------------------------------------------------- pad */}
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <Key key={digit} label={digit} onClick={() => press(digit)} disabled={!canType}>
            {digit}
          </Key>
        ))}
        <Key
          label="Delete last digit"
          onClick={() => setDigits((d) => d.slice(0, -1))}
          disabled={!canType || digits.length === 0}
        >
          <Delete className="size-5" />
        </Key>
        <Key label="0" onClick={() => press("0")} disabled={!canType}>
          0
        </Key>
        <Key label="Clear PIN" onClick={() => setDigits("")} disabled={!canType || digits.length === 0}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Clear</span>
        </Key>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <Button
          variant="champagne"
          size="lg"
          className="h-[52px] flex-1 text-[15px]"
          disabled={!ready}
          onClick={() => onSubmit(digits)}
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Checking…
            </>
          ) : (
            "Admit guest"
          )}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="h-[52px] text-primary-foreground/60 hover:bg-white/10 hover:text-primary-foreground"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Key({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-[50px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] font-sans text-[24px] font-semibold tabular-nums text-primary-foreground transition-colors hover:bg-white/[0.12] active:bg-white/[0.18] disabled:opacity-35 disabled:hover:bg-white/[0.06]"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * The typed fallback
 * ------------------------------------------------------------------ */

/**
 * Reading a pass without a camera.
 *
 * The scanner says "the box below does the same job" when it cannot start, so
 * there has to be a box. It is deliberately quiet - a guest should scan, not
 * type a 60-character code - but a tablet with a dead camera must still be
 * able to admit people, and the front desk is not always staffed.
 */
function PassBox({ onSubmit, disabled }: { onSubmit: (raw: string) => void; disabled: boolean }) {
  const [value, setValue] = React.useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    setValue("");
    onSubmit(raw);
  }

  return (
    <form onSubmit={submit} className="mt-5">
      <label
        htmlFor="pass-code"
        className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/40"
      >
        <Camera className="size-3.5" />
        No camera? Paste the pass
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="pass-code"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          placeholder="BA1…"
          className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-[13px] text-primary-foreground placeholder:text-primary-foreground/25 focus-visible:border-champagne-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne-400/25"
        />
        <Button
          type="submit"
          variant="outline"
          className="h-11 border-white/15 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          disabled={disabled || value.trim().length === 0}
        >
          Read
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Frame and panel
 * ------------------------------------------------------------------ */

function Frame({ label, children }: { label: string | null; children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-alley-900 text-primary-foreground">
      {/* The gold hairline the public site draws under its header. One pixel,
          and it is what makes this read as the same stationery. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-champagne-400/40 to-transparent"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-40 size-[520px] rounded-full bg-alley-700/40 blur-3xl"
      />

      <header className="relative flex items-center justify-between gap-4 px-5 py-4 sm:px-10">
        <div className="flex items-center gap-3">
          <img
            src="/brand/logo-ivory.png"
            alt=""
            width={1912}
            height={1912}
            className="h-11 w-11 object-contain drop-shadow-[0_2px_12px_rgba(7,25,20,0.45)]"
          />
          <div>
            <p className="font-display text-[17px] font-semibold leading-none tracking-tight">
              The Beauty Alley
            </p>
            <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-champagne-300/70">
              Arrivals
            </p>
          </div>
        </div>
        {label && (
          <p className="truncate text-[11.5px] text-primary-foreground/35">{label}</p>
        )}
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 pb-8 sm:px-8">
        <div className="w-full max-w-lg">{children}</div>
      </main>

      <footer className="relative px-5 pb-4 text-center text-[11px] text-primary-foreground/25 sm:px-10">
        Your stylist confirms with their PIN. Nothing is charged at this screen.
      </footer>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-alley-950/50 p-5 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)] backdrop-blur-sm sm:p-6">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Copy and small helpers
 * ------------------------------------------------------------------ */

function asApiError(err: unknown): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError(0, "UNKNOWN", String((err as Error)?.message ?? err));
}

function offlineFrom(error: ApiError): Screen {
  if (error.code === "KIOSK_REVOKED") {
    return {
      kind: "offline",
      title: "This screen has been switched off",
      message: "Please see the front desk and a member of staff will check you in.",
    };
  }
  if (error.code === "KIOSK_TOKEN_INVALID") {
    return {
      kind: "offline",
      title: "This screen is not recognised",
      message: "It needs a new door link from the owner before it can admit anyone.",
    };
  }
  return {
    kind: "offline",
    title: "The salon's system is not answering",
    message: "Please wait a moment, or ask at the front desk.",
  };
}

/** The API's verdict on a PIN, or null when the failure was not about the PIN. */
function pinFailure(error: ApiError): PinFailure | null {
  if (error.code === "KIOSK_PIN_INVALID") {
    const details = error.details as { attemptsLeft?: number } | undefined;
    return { kind: "wrong", attemptsLeft: details?.attemptsLeft ?? 0 };
  }
  if (error.code === "KIOSK_PIN_LOCKED") {
    const details = error.details as { retryAfterSeconds?: number } | undefined;
    return { kind: "locked", retryAfterSeconds: details?.retryAfterSeconds ?? 60 };
  }
  if (error.code === "KIOSK_PIN_INACTIVE") {
    return { kind: "inactive" };
  }
  return null;
}

function failureCopy(failure: PinFailure, secondsLeft: number): string {
  switch (failure.kind) {
    case "wrong":
      return failure.attemptsLeft > 0
        ? `That PIN was not recognised. ${failure.attemptsLeft} ${
            failure.attemptsLeft === 1 ? "try" : "tries"
          } left.`
        : "That PIN was not recognised. Please see the front desk.";
    case "locked":
      return `Too many wrong PINs. This screen will accept one again in ${waitLabel(secondsLeft)}.`;
    case "inactive":
      return "Please see the front desk and they will check you in.";
    case "failed":
      return failure.message;
  }
}

function waitLabel(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.ceil(seconds))} seconds`;
  return `${Math.ceil(seconds / 60)} minutes`;
}

/**
 * Why the door will not admit this guest.
 *
 * The order the API applies these in matters and is preserved in the copy: a
 * cancelled booking whose pass also expired reads "closed", because that is the
 * fact that decides what the guest does next.
 */
function blockedCopy(
  blocked: KioskBlocker,
  arrival: KioskArrival,
): { title: string; message: string } {
  switch (blocked) {
    case "ALREADY_CHECKED_IN":
      return {
        title: "You're already checked in",
        message: "This pass has been used. The front desk can help if you need anything.",
      };
    case "BOOKING_CLOSED":
      return {
        title: "This appointment is closed",
        message: "It was cancelled or has already been completed. The front desk can book you in again.",
      };
    case "PASS_REVOKED":
      return {
        title: "This pass is no longer valid",
        message: "It was replaced or withdrawn. Please see the front desk.",
      };
    case "DEPOSIT_DUE":
      return {
        title: "A deposit is still due",
        message: "Settle it at the front desk and they will check you in.",
      };
    case "PASS_EXPIRED":
      return {
        title: "This pass has expired",
        message: "The front desk can still check you in. Please see them.",
      };
    case "TOO_EARLY":
      return {
        title: "You're a little early",
        message: `This door opens ${arrival.arrivalWindowMinutes} minutes before your appointment. Please take a seat, or see the front desk.`,
      };
    case "TOO_LATE":
      return {
        title: "This appointment has passed",
        message: "Please see the front desk so they can help you rebook.",
      };
  }
}

function firstName(name: string | null): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || null;
}

/**
 * "Welcome, Ana" when the booking names a guest, "Welcome" when it does not.
 *
 * A guest booking can have no name at all - the constraint wants a name *and* a
 * phone, or a client - and "Welcome, there" is worse than not guessing.
 */
function greeting(name: string | null, lead = "Welcome"): string {
  const first = firstName(name);
  return first ? `${lead}, ${first}` : lead;
}
