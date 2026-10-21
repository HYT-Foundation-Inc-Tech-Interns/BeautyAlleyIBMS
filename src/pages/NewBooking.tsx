"use client";

/**
 * The desk's booking screen.
 *
 * This is the console's own version of `/book`, not a link to it. The public
 * page exists for a guest with no account and is shaped around that: no stylist
 * choice, no client lookup, a marketing frame. The desk needs the opposite —
 * assign the stylist, see the whole day at a glance, and hand the pass over
 * before the guest leaves the counter.
 *
 * What it deliberately does not do: invent availability. Every time shown comes
 * from `get_available_slots` for the chosen service and day, and the stylist
 * filter narrows those same slots rather than re-deriving them. If a stylist is
 * left on "any", the API assigns a qualified, rostered, free one exactly as the
 * public flow does.
 */

import * as React from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  Plus,
  Printer,
  Search,
  Sparkles,
  Tag,
  UserRound,
  X,
} from "lucide-react";

import {
  branchDay,
  branchLongDay,
  branchTime,
  branchToday,
  cn,
  minutesToLabel,
  peso,
  shiftDayKey,
} from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/auth/AuthProvider";
import { useAsync } from "@/lib/useAsync";
import type { Booking, ClientHit, PromoValidation, Service } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel, SectionHeading } from "@/components/app/bits";
import { ErrorNote, Loading, StatusBadge, TextField } from "@/components/app/api-bits";

const DAYS_AHEAD = 14;
const PHONE_RE = /^\+?[0-9 ()\-]{7,20}$/;

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-PH", { weekday: "short", timeZone: "Asia/Manila" });
const DAY_FMT = new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", timeZone: "Asia/Manila" });

/** A calendar day key rendered as the two lines the date chips show. */
function chipDay(key: string) {
  const atNoon = new Date(`${key}T12:00:00+08:00`);
  return { weekday: WEEKDAY_FMT.format(atNoon), date: DAY_FMT.format(atNoon) };
}

export default function NewBooking() {
  const navigate = useNavigate();
  const { role } = useAuth();

  const [serviceId, setServiceId] = React.useState("");
  const [date, setDate] = React.useState(() => branchToday());
  const [startTime, setStartTime] = React.useState("");
  const [employeeId, setEmployeeId] = React.useState("");
  const [term, setTerm] = React.useState("");

  /*
   * Who the booking is for.
   *
   * A client picked from the book is attached by id — the API links the booking
   * to their record, which is what puts it in their history and their own
   * "my bookings" screen. Leaving the picker empty books a guest, exactly as
   * the public page does.
   */
  const [client, setClient] = React.useState<ClientHit | null>(null);
  const [clientQuery, setClientQuery] = React.useState("");
  const [clientHits, setClientHits] = React.useState<ClientHit[]>([]);
  const [clientSearching, setClientSearching] = React.useState(false);

  const [guestName, setGuestName] = React.useState("");
  const [guestPhone, setGuestPhone] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [promoInput, setPromoInput] = React.useState("");
  const [promo, setPromo] = React.useState<PromoValidation | null>(null);
  const [promoBusy, setPromoBusy] = React.useState(false);

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [localErrors, setLocalErrors] = React.useState<Record<string, string>>({});
  const [created, setCreated] = React.useState<Booking | null>(null);

  const catalogue = useAsync("desk:services", async () =>
    (await api.services.list({ limit: 100 })).data,
  );

  const slots = useAsync(
    `desk:slots:${serviceId}:${date}`,
    async () => {
      if (!serviceId) return null;
      return api.availability({ serviceId, date, intervalMinutes: 30 });
    },
  );

  const service: Service | undefined = catalogue.data?.find((s) => s.id === serviceId);

  const services = React.useMemo(() => {
    const rows = catalogue.data ?? [];
    const needle = term.trim().toLowerCase();
    return needle
      ? rows.filter((s) => s.name.toLowerCase().includes(needle))
      : rows;
  }, [catalogue.data, term]);

  const employeeNames = useAsync("desk:employees", async () => {
    const page = await api.employees.list({ limit: 100, sort: "full_name", order: "asc" });
    return new Map(page.data.map((e) => [e.id, e.fullName]));
  });

  const employeeNameMap = employeeNames.data ?? new Map<string, string>();

  /* The stylist list comes from the same availability answer, so it can only
     offer people who are actually free for this service on this day. */
  const stylists = React.useMemo(() => {
    const groups = slots.data?.employees ?? [];
    const seen = new Set<string>();
    for (const group of groups) seen.add(group.employeeId);
    return [...seen].map((id) => ({ id, name: employeeNameMap.get(id) ?? "Stylist" }));
  }, [slots.data, employeeNameMap]);

  const times = React.useMemo(() => {
    const groups = slots.data?.employees ?? [];
    const byStart = new Map<string, number>();
    for (const group of groups) {
      if (employeeId && group.employeeId !== employeeId) continue;
      for (const slot of group.slots) {
        byStart.set(slot.start, (byStart.get(slot.start) ?? 0) + 1);
      }
    }
    return [...byStart.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([start, free]) => ({ start, free }));
  }, [slots.data, employeeId]);

  React.useEffect(() => {
    setStartTime("");
  }, [serviceId, date, employeeId]);

  /*
   * Debounced lookup. The cleanup cancels the in-flight answer as well as the
   * timer, so a slow reply for "ad" cannot land on top of the results for
   * "ada" — a classic way for a picker to show the wrong person.
   */
  React.useEffect(() => {
    const term = clientQuery.trim();
    if (client || term.length < 2) {
      setClientHits([]);
      return;
    }

    let live = true;
    const timer = setTimeout(async () => {
      setClientSearching(true);
      try {
        const hits = await api.clients.search(term);
        if (live) setClientHits(hits);
      } catch {
        if (live) setClientHits([]);
      } finally {
        if (live) setClientSearching(false);
      }
    }, 250);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [clientQuery, client]);

  const subtotalCents = service?.priceCents ?? 0;
  const discountCents = promo?.valid ? promo.discountCents : 0;
  const totalCents = Math.max(0, subtotalCents - discountCents);

  async function checkPromo() {
    const code = promoInput.trim();
    if (!code || !service) return;
    setPromoBusy(true);
    setPromo(null);
    try {
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !service) return;

    const next: Record<string, string> = {};
    if (!startTime) next.startTime = "Choose a time";
    if (!client) {
      if (!guestName.trim()) next.guestName = "A name for the booking";
      if (!PHONE_RE.test(guestPhone.trim())) {
        next.guestPhone = "A phone number, in case anything changes";
      }
    }
    setLocalErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    setError(null);
    try {
      const booking = await api.bookings.create({
        serviceIds: [service.id],
        startTime,
        ...(employeeId ? { employeeId } : {}),
        // A picked client is attached by id; otherwise the booking is a guest's.
        ...(client
          ? { clientId: client.id }
          : { guest: { name: guestName.trim(), phone: guestPhone.trim() } }),
        ...(promo?.valid && promo.code ? { promoCode: promo.code } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setCreated(booking);
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not create the booking"));
      setSubmitting(false);
    }
  }

  function another() {
    setCreated(null);
    setServiceId("");
    setStartTime("");
    setEmployeeId("");
    setClient(null);
    setClientQuery("");
    setClientHits([]);
    setGuestName("");
    setGuestPhone("");
    setNotes("");
    setPromoInput("");
    setPromo(null);
    setLocalErrors({});
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /*
   * The administrator monitors and edits; the desk creates. Checked here, after
   * every hook has run, so a role that resolves after mount cannot change the
   * number of hooks this component calls.
   */
  if (role === "ADMIN") return <Navigate to="/app/bookings" replace />;

  if (created) {
    return <CreatedPass booking={created} onAnother={another} />;
  }

  return (
    <div className="mx-auto w-full max-w-[1300px] space-y-6">
      <SectionHeading
        eyebrow="Front desk"
        title="New booking"
        description="Book for a guest at the counter: pick the treatment, the day and the stylist, then hand over the pass."
        action={
          <Button asChild variant="outline">
            <Link to="/app/bookings">
              <ArrowLeft className="size-4" />
              Back to bookings
            </Link>
          </Button>
        }
      />

      <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          {/* 1 — treatment */}
          <Panel className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-[17px] font-semibold tracking-tight">
                1. Treatment
              </h2>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Search the menu…"
                  aria-label="Search treatments"
                  className="h-9 w-[200px] rounded-full border border-border bg-card pl-8 pr-3 text-[12.5px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                />
              </div>
            </div>

            {catalogue.error ? (
              <ErrorNote error={catalogue.error} onRetry={catalogue.reload} className="mt-4" />
            ) : catalogue.initial ? (
              <Loading label="Fetching the menu…" className="mt-4 border-0 py-6" />
            ) : (
              <div className="mt-4 grid max-h-[340px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {services.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setServiceId(row.id)}
                    aria-pressed={serviceId === row.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
                      serviceId === row.id
                        ? "border-primary bg-primary/[0.06]"
                        : "border-border bg-card hover:border-primary/40",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{row.name}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock3 className="size-3" />
                        {minutesToLabel(row.durationMinutes)}
                      </span>
                    </span>
                    <span className="shrink-0 font-display text-[14px] font-semibold tabular-nums">
                      {peso(row.priceCents)}
                    </span>
                  </button>
                ))}
                {services.length === 0 && (
                  <p className="text-[12.5px] text-muted-foreground">Nothing matches that.</p>
                )}
              </div>
            )}
          </Panel>

          {/* 2 — when */}
          <Panel className="p-5">
            <h2 className="font-display text-[17px] font-semibold tracking-tight">2. When</h2>

            <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
              {Array.from({ length: DAYS_AHEAD }, (_, i) => shiftDayKey(branchToday(), i)).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDate(key)}
                  aria-pressed={date === key}
                  className={cn(
                    "shrink-0 rounded-lg border px-3 py-2 text-center transition-colors",
                    date === key
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:border-primary/40",
                  )}
                >
                  <span className="block text-[10px] uppercase tracking-wide opacity-70">
                    {chipDay(key).weekday}
                  </span>
                  <span className="block text-[13px] font-semibold tabular-nums">
                    {chipDay(key).date}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4">
              {!serviceId ? (
                <p className="text-[12.5px] text-muted-foreground">Pick a treatment first.</p>
              ) : slots.error ? (
                <ErrorNote error={slots.error} onRetry={slots.reload} />
              ) : slots.initial ? (
                <Loading label="Reading the day…" className="border-0 py-6" />
              ) : times.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted-foreground">
                  No free slot for that combination. Try another day or another stylist.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {times.map((slot) => (
                    <button
                      key={slot.start}
                      type="button"
                      onClick={() => setStartTime(slot.start)}
                      aria-pressed={startTime === slot.start}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-[12.5px] font-medium tabular-nums transition-colors",
                        startTime === slot.start
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:border-primary/40",
                      )}
                    >
                      {branchTime(slot.start)}
                      {!employeeId && slot.free > 1 && (
                        <span className="ml-1.5 text-[10.5px] opacity-70">{slot.free}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {localErrors.startTime && (
              <p className="mt-2 text-[11.5px] text-clay">{localErrors.startTime}</p>
            )}
          </Panel>

          {/* 3 — who */}
          <Panel className="p-5">
            <h2 className="font-display text-[17px] font-semibold tracking-tight">3. Who</h2>

            {/* An existing client, or a guest — never both. */}
            {client ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/[0.05] px-3.5 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {client.fullName.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{client.fullName}</p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {[client.phone, client.email].filter(Boolean).join(" · ") || "Client record"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setClient(null);
                    setClientQuery("");
                  }}
                >
                  <X className="size-3.5" />
                  Change
                </Button>
              </div>
            ) : (
              <div className="mt-4">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Existing client
                  </span>
                  <div className="relative mt-1.5">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                    <input
                      value={clientQuery}
                      onChange={(e) => setClientQuery(e.target.value)}
                      placeholder="Search the client book by name, phone or email…"
                      className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-[13px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                    />
                    {clientSearching && (
                      <Loader2 className="absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </label>

                {clientHits.length > 0 && (
                  <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card">
                    {clientHits.map((hit) => (
                      <li key={hit.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setClient(hit);
                            setClientHits([]);
                            setClientQuery("");
                            setLocalErrors({});
                          }}
                          className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-primary/[0.04]"
                        >
                          <UserRound className="size-3.5 shrink-0 text-primary/70" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium">
                              {hit.fullName}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {[hit.phone, hit.email].filter(Boolean).join(" · ") || "No contact details"}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {clientQuery.trim().length >= 2 && !clientSearching && clientHits.length === 0 && (
                  <p className="mt-2 text-[11.5px] text-muted-foreground">
                    No client matches that — leave it blank to book them as a guest.
                  </p>
                )}
              </div>
            )}

            {!client && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Guest name"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Ada Cruz"
                  error={localErrors.guestName}
                />
                <TextField
                  label="Phone"
                  type="tel"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  placeholder="+63 917 000 0000"
                  error={localErrors.guestPhone}
                  autoComplete="tel"
                />
              </div>
            )}

            <label className="mt-4 block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Stylist
              </span>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="mt-1.5 block h-10 w-full rounded-lg border border-border bg-card px-3 text-[13.5px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              >
                <option value="">Assign the first free stylist</option>
                {stylists.map((s) => (
                  <option key={s.id} value={s.id}>
                    {employeeNameMap.get(s.id) ?? s.name}
                  </option>
                ))}
              </select>
            </label>
          </Panel>
        </div>

        {/* summary */}
        <aside className="space-y-4">
          <Panel className="p-5">
            <h2 className="font-display text-[17px] font-semibold tracking-tight">
              Your appointment
            </h2>

            <dl className="mt-4 space-y-3 text-[13px]">
              <Row label="Treatment" value={service?.name ?? "—"} />
              <Row label="When" value={startTime ? `${branchDay(startTime)} · ${branchTime(startTime)}` : "—"} />
              <Row
                label="Stylist"
                value={employeeId ? employeeNameMap.get(employeeId) ?? "Chosen" : "First free"}
              />
              <Row label="Duration" value={service ? minutesToLabel(service.durationMinutes) : "—"} />
              <Row label="For" value={client?.fullName ?? (guestName.trim() || "—")} />
            </dl>

            <div className="mt-5 border-t border-border/70 pt-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Promo code
              </span>
              <div className="mt-2 flex gap-2">
                <div className="relative flex-1">
                  <Tag className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                  <input
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
                  {promo.valid && <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />}
                  {promo.message}
                </p>
              )}
            </div>

            <dl className="mt-4 space-y-2 border-t border-border/70 pt-4 text-[13px]">
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

            <label className="mt-4 block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Note for the floor
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Allergies, preferences, running late…"
                className="mt-1.5 w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-[13px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              />
            </label>

            {error && <ErrorNote error={error} className="mt-4" />}

            <Button
              type="submit"
              size="lg"
              className="mt-5 h-11 w-full"
              disabled={submitting || !service || !startTime}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Booking…
                </>
              ) : (
                <>
                  <Plus className="size-4" />
                  Confirm booking
                </>
              )}
            </Button>
            <p className="mt-2 text-center text-[11.5px] text-muted-foreground">
              No payment now. The pass is issued the moment it is confirmed.
            </p>
          </Panel>
        </aside>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

/**
 * The pass, handed over at the counter.
 *
 * The create response carries the freshly signed QR, so there is no second
 * round trip and no URL to keep — the desk prints this or shows the screen.
 */
function CreatedPass({ booking, onAnother }: { booking: Booking; onAnother: () => void }) {
  const guest = booking.client?.fullName ?? booking.guest?.name ?? "Guest booking";
  const qr = booking.qr;

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-champagne-600">
            Booked · {booking.reference}
          </p>
          <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight">
            The chair is held.
          </h1>
        </div>
        <Button asChild variant="outline">
          <Link to="/app/bookings">
            <ArrowLeft className="size-4" />
            Bookings
          </Link>
        </Button>
      </div>

      <div data-print="pass" className="rounded-xl border border-border/80 bg-card p-6 shadow-soft">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex min-w-[70px] flex-col rounded-lg bg-sand-50 px-3 py-2 text-center">
            <span className="font-display text-[16px] font-semibold leading-none tabular-nums">
              {branchTime(booking.startTime)}
            </span>
            <span className="mt-1 text-[10px] text-muted-foreground">{branchDay(booking.startTime)}</span>
          </span>
          <div className="min-w-[170px] flex-1">
            <p className="font-display text-[18px] font-semibold leading-tight tracking-tight">{guest}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Sparkles className="size-3" />
                {booking.items.map((i) => i.name).join(", ") || "—"}
              </span>
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3" />
                {booking.employee.fullName}
              </span>
            </p>
          </div>
          <StatusBadge status={booking.status} />
        </div>

        <div className="mt-6 flex flex-col items-center border-t border-border/70 pt-6">
          {qr?.url ? (
            <>
              <div className="rounded-xl bg-white p-4 ring-1 ring-border">
                <QRCodeSVG value={qr.url} size={180} bgColor="#ffffff" fgColor="#1B4D3E" level="M" />
              </div>
              <p className="mt-3 text-center text-[12px] text-muted-foreground">
                Scanned once at reception · valid until {branchDay(qr.expiresAt)} · {branchTime(qr.expiresAt)}
              </p>
            </>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">No live pass for this booking.</p>
          )}
        </div>

        <dl className="mt-6 grid gap-x-8 gap-y-4 border-t border-border/70 pt-5 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">When</dt>
            <dd className="mt-0.5">
              {branchLongDay(booking.startTime)}
              <br />
              {branchTime(booking.startTime)} – {branchTime(booking.endTime)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Total</dt>
            <dd className="mt-0.5 font-display text-[17px] font-semibold text-primary">
              {peso(booking.totalCents)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Reference</dt>
            <dd className="mt-0.5 font-mono text-[12.5px]">{booking.reference}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Guest</dt>
            <dd className="mt-0.5">
              {booking.guest ? `${booking.guest.name} · ${booking.guest.phone}` : guest}
            </dd>
          </div>
        </dl>
      </div>

      <div data-print="hide" className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" />
          Print pass
        </Button>
        <Button onClick={onAnother}>
          <Plus className="size-4" />
          New booking
        </Button>
        <Badge variant="outline" className="ml-auto">
          <CalendarDays className="mr-1 size-3" />
          {booking.reference}
        </Badge>
      </div>
    </div>
  );
}
