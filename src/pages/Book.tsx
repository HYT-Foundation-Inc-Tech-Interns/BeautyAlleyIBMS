"use client";

/**
 * The booking desk.
 *
 * ## Why one service per booking
 *
 * The API accepts up to ten service ids on a booking, but availability is
 * computed by `get_available_slots(p_service_id, p_date, …)` — a single
 * service, whose duration is what determines how long the slot must be. A
 * multi-service booking would need the *summed* duration to be checked against
 * the stylist's shift, and there is no endpoint that answers that question. So
 * the UI books one service at a time rather than letting a visitor assemble a
 * cart that the slot grid cannot honour. The API's capability is not the same
 * thing as a promise the availability endpoint can keep.
 *
 * ## Why guest details are only asked for when there is no account
 *
 * A signed-in client books against their own record — the API ignores a
 * `guest` payload from them entirely, and ignores a `clientId` from anyone
 * else. So the form shows the fields that will actually be used, rather than
 * asking for a name it is going to discard.
 */

import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  Sparkles,
  Tag,
  UserRound,
  X,
} from "lucide-react";

import { branchDay, branchTime, branchToday, cn, minutesToLabel, peso, shiftDayKey } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { PromoValidation, Service } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import {
  CategoryBadge,
  EmptyNote,
  ErrorNote,
  FieldError,
  Loading,
  PersonAvatar,
  TextField,
} from "@/components/app/api-bits";
import { PageHead, PublicShell } from "@/components/app/PublicShell";
import { useAuth } from "@/auth/AuthProvider";

/** How many days ahead the picker offers. */
const DAYS_AHEAD = 14;

const DAY_OPTIONS = Array.from({ length: DAYS_AHEAD }, (_, i) => shiftDayKey(branchToday(), i));

function StepHeading({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
        {n}
      </span>
      <div>
        <h2 className="font-display text-[20px] font-semibold leading-tight tracking-tight">
          {title}
        </h2>
        {hint && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export default function Book() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { status, me } = useAuth();

  const [serviceId, setServiceId] = React.useState(params.get("service") ?? "");
  const [date, setDate] = React.useState(DAY_OPTIONS[0]);
  const [employeeId, setEmployeeId] = React.useState("");
  const [startTime, setStartTime] = React.useState("");

  const [guestName, setGuestName] = React.useState("");
  const [guestPhone, setGuestPhone] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const [promoInput, setPromoInput] = React.useState("");
  const [promo, setPromo] = React.useState<PromoValidation | null>(null);
  const [promoBusy, setPromoBusy] = React.useState(false);

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [localErrors, setLocalErrors] = React.useState<Record<string, string>>({});

  const signedInClient = status === "authenticated" && me?.role === "CLIENT";

  const catalogue = useAsync("book:services", async () =>
    (await api.services.list({ limit: 100 })).data,
  );
  const roster = useAsync("book:employees", async () => (await api.employees.list({ limit: 50 })).data);

  const slots = useAsync(
    `book:slots:${serviceId}:${date}:${employeeId}`,
    async () => {
      if (!serviceId) return null;
      return api.availability({
        serviceId,
        date,
        ...(employeeId ? { employeeId } : {}),
        intervalMinutes: 30,
      });
    },
  );

  const service: Service | undefined = catalogue.data?.find((s) => s.id === serviceId);
  const employeeName = (id: string) =>
    roster.data?.find((e) => e.id === id)?.fullName ?? "Stylist";

  // Changing the service or the day invalidates the chosen slot — the slot was
  // picked against a different duration or a different day's grid.
  React.useEffect(() => {
    setStartTime("");
  }, [serviceId, date, employeeId]);

  async function checkPromo() {
    const code = promoInput.trim();
    if (!code || !service) return;
    setPromoBusy(true);
    setPromo(null);
    try {
      // Always 200 — an unknown code is a normal answer, not an error. So this
      // only needs to render the verdict, not handle a failure case.
      setPromo(
        await api.promos.validate({
          code,
          serviceIds: [service.id],
          subtotalCents: service.priceCents,
          ...(guestPhone.trim() ? { guestPhone: guestPhone.trim() } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not check that code"));
    } finally {
      setPromoBusy(false);
    }
  }

  const subtotalCents = service?.priceCents ?? 0;
  const discountCents = promo?.valid ? promo.discountCents : 0;
  const totalCents = Math.max(0, subtotalCents - discountCents);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !service) return;

    const next: Record<string, string> = {};
    if (!startTime) next.startTime = "Choose a time";
    if (!signedInClient) {
      if (!guestName.trim()) next.guestName = "We need a name for the booking";
      if (!/^\+?[0-9 ()\-]{7,20}$/.test(guestPhone.trim())) {
        next.guestPhone = "A phone number lets us reach you if anything changes";
      }
    }
    setLocalErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    setError(null);

    try {
      const booking = await api.bookings.create({
        serviceIds: [service.id],
        ...(employeeId ? { employeeId } : {}),
        startTime,
        ...(signedInClient
          ? {}
          : { guest: { name: guestName.trim(), phone: guestPhone.trim() } }),
        ...(promo?.valid && promo.code ? { promoCode: promo.code } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });

      // The booking id is the capability for a guest — it is what the pass URL
      // carries, and it is the only thing that proves the booking is theirs.
      navigate(`/pass/${booking.id}`, { replace: true, state: { fresh: true } });
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not complete the booking"),
      );
      setSubmitting(false);
    }
  }

  const dayHasSlots = (slots.data?.totalSlots ?? 0) > 0;

  return (
    <PublicShell>
      <PageHead
        eyebrow="Reserve a chair"
        title={
          <>
            Three steps, and it's
            <span className="italic text-champagne-300"> yours.</span>
          </>
        }
        lede="Pick a treatment, choose a time that suits, and leave us a name. You'll get an arrival pass the moment it's confirmed."
      />

      <form onSubmit={onSubmit} className="container grid gap-10 py-14 lg:grid-cols-[1.5fr_1fr]">
        {/* ------------------------------------------------------- steps */}
        <div className="space-y-12">
          {/* 1 — service */}
          <section>
            <StepHeading n={1} title="Choose a treatment" hint="One treatment per appointment." />
            <div className="mt-5">
              {catalogue.error ? (
                <ErrorNote error={catalogue.error} onRetry={catalogue.reload} />
              ) : catalogue.initial ? (
                <Loading label="Fetching the menu…" />
              ) : catalogue.data && catalogue.data.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {catalogue.data.map((option) => {
                    const selected = option.id === serviceId;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setServiceId(option.id)}
                        aria-pressed={selected}
                        className={cn(
                          "flex flex-col rounded-xl border p-4 text-left transition-[border-color,box-shadow,background-color]",
                          selected
                            ? "border-primary bg-primary/[0.04] shadow-soft"
                            : "border-border/80 bg-card hover:border-primary/30",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <CategoryBadge category={option.category} />
                          {selected && <CheckCircle2 className="size-4 text-primary" />}
                        </div>
                        <p className="mt-3 font-display text-[17px] font-semibold leading-tight tracking-tight">
                          {option.name}
                        </p>
                        <p className="mt-1.5 flex items-center gap-3 text-[12px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="size-3" />
                            {minutesToLabel(option.durationMinutes)}
                          </span>
                          <span className="font-medium text-primary">
                            {peso(option.priceCents)}
                          </span>
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyNote
                  icon={Sparkles}
                  title="No services published"
                  description="The catalogue is empty, so there is nothing to book yet."
                />
              )}
            </div>
          </section>

          {/* 2 — time */}
          <section className={cn(!serviceId && "pointer-events-none opacity-45")}>
            <StepHeading
              n={2}
              title="Pick a day and a time"
              hint={serviceId ? undefined : "Choose a treatment first."}
            />

            <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
              {DAY_OPTIONS.map((day) => {
                const selected = day === date;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setDate(day)}
                    aria-pressed={selected}
                    className={cn(
                      "flex min-w-[74px] shrink-0 flex-col items-center rounded-xl border px-3 py-2.5 transition-colors",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/80 bg-card hover:border-primary/30",
                    )}
                  >
                    <span className="text-[11px] uppercase tracking-wide opacity-70">
                      {branchDay(`${day}T12:00:00Z`).split(" ")[0]}
                    </span>
                    <span className="mt-0.5 font-display text-[17px] font-semibold leading-none">
                      {Number(day.slice(8, 10))}
                    </span>
                    <span className="mt-1 text-[10px] opacity-70">
                      {branchDay(`${day}T12:00:00Z`).split(" ").slice(1).join(" ")}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5">
              <label
                htmlFor="stylist"
                className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Stylist
              </label>
              <select
                id="stylist"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="mt-1.5 h-10 w-full max-w-xs rounded-lg border border-border bg-card px-3 text-[13.5px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              >
                <option value="">Anyone available</option>
                {roster.data?.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                    {person.title ? ` — ${person.title}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-6">
              {slots.error ? (
                <ErrorNote error={slots.error} onRetry={slots.reload} />
              ) : !serviceId ? (
                <p className="rounded-xl border border-dashed border-border py-10 text-center text-[13px] text-muted-foreground">
                  Times appear once a treatment is chosen.
                </p>
              ) : slots.initial ? (
                <Loading label="Checking the diary…" />
              ) : !dayHasSlots ? (
                <EmptyNote
                  icon={CalendarDays}
                  title="Nothing free that day"
                  description="The salon is closed, or every qualified stylist is fully booked. Try another day."
                />
              ) : (
                <div className="space-y-6">
                  {slots.data?.employees.map((group) => (
                    <div key={group.employeeId}>
                      <p className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
                        <PersonAvatar name={employeeName(group.employeeId)} className="size-6" />
                        {employeeName(group.employeeId)}
                        <span className="text-[11.5px] font-normal text-muted-foreground">
                          {group.slots.length} slot{group.slots.length === 1 ? "" : "s"}
                        </span>
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {group.slots.map((slot) => {
                          const selected = slot.start === startTime;
                          return (
                            <button
                              key={slot.start}
                              type="button"
                              onClick={() => {
                                setStartTime(slot.start);
                                setEmployeeId(group.employeeId);
                              }}
                              aria-pressed={selected}
                              className={cn(
                                "rounded-full border px-3.5 py-1.5 text-[12.5px] tabular-nums transition-colors",
                                selected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border/80 bg-card hover:border-primary/40 hover:bg-primary/[0.05]",
                              )}
                            >
                              {branchTime(slot.start)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <FieldError>{localErrors.startTime}</FieldError>
            </div>
          </section>

          {/* 3 — who */}
          <section className={cn(!startTime && "pointer-events-none opacity-45")}>
            <StepHeading
              n={3}
              title="Who is it for?"
              hint={
                signedInClient
                  ? `Booking onto your account, ${me?.fullName ?? me?.email}.`
                  : "No account needed — just a name and a number."
              }
            />

            <div className="mt-5 space-y-4">
              {signedInClient ? (
                <div className="flex items-start gap-3 rounded-xl border border-alley-200 bg-alley-50 px-5 py-4">
                  <BadgeCheck className="mt-0.5 size-5 shrink-0 text-alley-700" />
                  <p className="text-[13px] leading-relaxed text-alley-700">
                    This appointment will be saved to your account, so it appears
                    under <span className="font-medium">My bookings</span> and the
                    pass can be re-issued if you lose it.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      label="Your name"
                      placeholder="Ada Cruz"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      error={localErrors.guestName}
                      autoComplete="name"
                    />
                    <TextField
                      label="Phone"
                      type="tel"
                      placeholder="+63 917 000 0000"
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      error={localErrors.guestPhone}
                      autoComplete="tel"
                    />
                  </div>
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    Booking as a guest?{" "}
                    <Link to="/register" className="font-medium text-primary hover:underline">
                      Create an account
                    </Link>{" "}
                    instead and keep a history of your visits.
                  </p>
                </>
              )}

              <TextField
                label="Notes for your stylist"
                placeholder="Anything we should know — allergies, preferences, running late."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </section>
        </div>

        {/* ----------------------------------------------------- summary */}
        <aside className="lg:sticky lg:top-[92px] lg:h-fit">
          <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-lift">
            <h2 className="font-display text-[19px] font-semibold tracking-tight">Your appointment</h2>

            <dl className="mt-5 space-y-3.5 text-[13px]">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Treatment</dt>
                <dd className="text-right font-medium">{service?.name ?? "—"}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Stylist</dt>
                <dd className="text-right font-medium">
                  {employeeId ? employeeName(employeeId) : "Anyone available"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">When</dt>
                <dd className="text-right font-medium">
                  {startTime ? (
                    <>
                      {branchDay(startTime)}
                      <br />
                      {branchTime(startTime)}
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">For</dt>
                <dd className="text-right font-medium">
                  {signedInClient ? me?.fullName ?? me?.email : guestName.trim() || "—"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Duration</dt>
                <dd className="text-right font-medium">
                  {service ? minutesToLabel(service.durationMinutes) : "—"}
                </dd>
              </div>
            </dl>

            {/* promo */}
            <div className="mt-6 border-t border-border/70 pt-5">
              <label
                htmlFor="promo"
                className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Promo code
              </label>
              <div className="mt-2 flex gap-2">
                <div className="relative flex-1">
                  <Tag className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                  <input
                    id="promo"
                    value={promoInput}
                    onChange={(e) => {
                      setPromoInput(e.target.value.toUpperCase());
                      setPromo(null);
                    }}
                    placeholder="SAVE10"
                    className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-[13px] uppercase outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={checkPromo}
                  disabled={promoBusy || !promoInput.trim() || !service}
                >
                  {promoBusy ? <Loader2 className="size-4 animate-spin" /> : "Apply"}
                </Button>
              </div>
              {promo && (
                <p
                  className={cn(
                    "mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed",
                    promo.valid ? "text-alley-600" : "text-clay",
                  )}
                >
                  {promo.valid ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                  ) : (
                    <X className="mt-0.5 size-3.5 shrink-0" />
                  )}
                  {promo.message}
                </p>
              )}
            </div>

            {/* totals */}
            <dl className="mt-6 space-y-2.5 border-t border-border/70 pt-5 text-[13px]">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{peso(subtotalCents)}</dd>
              </div>
              {discountCents > 0 && (
                <div className="flex items-center justify-between text-alley-600">
                  <dt>Discount</dt>
                  <dd className="tabular-nums">−{peso(discountCents)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-border/70 pt-3">
                <dt className="font-medium">Total</dt>
                <dd className="font-display text-[22px] font-semibold tabular-nums text-primary">
                  {peso(totalCents)}
                </dd>
              </div>
            </dl>

            {error && (
              <ErrorNote
                error={error}
                className="mt-5"
                onRetry={error.code === "SLOT_TAKEN" ? slots.reload : undefined}
              />
            )}

            <Button
              type="submit"
              size="lg"
              className="mt-6 h-12 w-full"
              disabled={submitting || !service || !startTime}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Reserving…
                </>
              ) : (
                <>
                  Confirm booking
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>

            <p className="mt-3 text-center text-[11.5px] leading-relaxed text-muted-foreground">
              No payment now. You can cancel free of charge up to two hours before.
            </p>
          </div>

          {status !== "authenticated" && (
            <p className="mt-4 text-center text-[12px] text-muted-foreground">
              <UserRound className="mr-1 inline size-3.5" />
              Already booked?{" "}
              <Link to="/scan" className="font-medium text-primary hover:underline">
                Find your pass
              </Link>
            </p>
          )}
        </aside>
      </form>
    </PublicShell>
  );
}
