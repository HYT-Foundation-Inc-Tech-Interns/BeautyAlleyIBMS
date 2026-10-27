"use client";

/**
 * The catalogue.
 *
 * Services are data, not code: the public menu, the booking page and the
 * availability engine all read the same rows. That is why this screen exists —
 * adding a treatment used to mean a migration and a deploy, and a price change
 * meant the site could quietly disagree with the desk.
 *
 * Three things the screen is careful about:
 *
 * **Retiring is not deleting.** `booking_items.service_id` is
 * `on delete set null`, so a hard delete would blank out what every past
 * booking was for. `DELETE /services/:id` therefore deactivates: the row
 * disappears from every public surface and the history still reads. The
 * retired rows stay visible here behind the toggle, so nothing vanishes
 * without a trace.
 *
 * **Prices are typed in pesos, stored in centavos.** The form parses what the
 * person types into an integer number of minor units before it leaves the
 * browser, so no float ever reaches the database.
 *
 * **Duration is required.** The column is NOT NULL and the API refuses
 * anything under five minutes — a treatment that takes no time cannot be
 * scheduled, and a slot of zero length would let two bookings overlap.
 */

import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Clock3,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Tag,
  X,
} from "lucide-react";

import { cn, minutesToLabel, peso } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Service, ServiceCategory, ServiceInput, ServiceSubcategory } from "@/lib/api-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, StatTile } from "@/components/app/bits";
import { EmptyNote, ErrorNote, Loading, TextField } from "@/components/app/api-bits";

const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  SPA: "Spa",
  SALON: "Salon",
  WELLNESS: "Wellness",
};

const CATEGORIES: ServiceCategory[] = ["SPA", "SALON", "WELLNESS"];

/**
 * "800", "₱1,200" or "800.50" -> 80000 / 120000 / 80050.
 * `null` means the text was not a price, which the form reports as an error
 * rather than silently turning into zero.
 */
function parsePrice(input: string): number | null {
  const cleaned = input.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** The peso figure a person would type, without the symbol or separators. */
function priceForInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

export default function ServicesAdmin() {
  const [includeRetired, setIncludeRetired] = React.useState(false);
  const [composing, setComposing] = React.useState(false);
  const [editing, setEditing] = React.useState<Service | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<ApiError | null>(null);

  const catalogue = useAsync(`catalogue:${includeRetired}`, () =>
    api.services.list({
      limit: 100,
      includeInactive: includeRetired,
      sort: "price_cents",
      order: "asc",
    }),
  );

  // The second catalogue level, so a new service can be filed under the group
  // the public menu already renders.
  const groups = useAsync("catalogue:groups", () => api.subcategories.menu());

  // `list` answers with a page envelope (`{ data, meta }`) because the same
  // endpoint serves the public menu, which paginates. This page asks for 100
  // and reads the array.
  const rows: Service[] = catalogue.data?.data ?? [];
  const live = rows.filter((s) => s.isActive);
  const averagePrice = live.length
    ? Math.round(live.reduce((sum, s) => sum + s.priceCents, 0) / live.length)
    : 0;

  async function retire(service: Service) {
    setBusyId(service.id);
    setActionError(null);
    try {
      await api.services.retire(service.id);
      catalogue.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not retire that service"));
    } finally {
      setBusyId(null);
    }
  }

  async function restore(service: Service) {
    setBusyId(service.id);
    setActionError(null);
    try {
      await api.services.update(service.id, { isActive: true });
      catalogue.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not restore that service"));
    } finally {
      setBusyId(null);
    }
  }

  function closeForm() {
    setComposing(false);
    setEditing(null);
  }

  function onSaved() {
    closeForm();
    catalogue.reload();
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-7">
      <PageHeader
        eyebrow="Catalogue"
        icon={Sparkles}
        title="Services"
        description="What the salon sells. The public menu, the booking page and the availability engine all read these rows, so a change here is live everywhere."
        actions={
          <>
            <Button variant="outline" onClick={catalogue.reload} disabled={catalogue.loading}>
              <RefreshCw className={cn("size-4", catalogue.loading && "animate-spin")} />
              Refresh
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setComposing(true);
              }}
            >
              <Plus className="size-4" />
              New service
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIncludeRetired((v) => !v)}
            aria-pressed={includeRetired}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground/80 transition-colors hover:bg-white/[0.14]"
          >
            <Archive className="size-3.5" />
            {includeRetired ? "Showing retired" : "Active only"}
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground/80">
            <CheckCircle2 className="size-3.5" />
            {live.length} on the menu
          </span>
        </div>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="On the menu" value={String(live.length)} hint="bookable right now" icon={CheckCircle2} />
        <StatTile
          label="Average price"
          value={live.length ? peso(averagePrice) : "—"}
          hint="across active services"
          icon={Tag}
          tone="accent"
        />
        <StatTile
          label="Longest treatment"
          value={live.length ? minutesToLabel(Math.max(...live.map((s) => s.durationMinutes))) : "—"}
          hint="one appointment, start to finish"
          icon={Clock3}
        />
      </div>

      {actionError && <ErrorNote error={actionError} />}

      {(composing || editing) && (
        <ServiceForm
          // Keyed so switching from editing one row to another remounts the
          // form. Without it the state initialisers run once and the fields
          // keep the previous service's values.
          key={editing?.id ?? "new"}
          service={editing}
          groups={groups.data ?? []}
          onSaved={onSaved}
          onCancel={closeForm}
        />
      )}

      {catalogue.error ? (
        <ErrorNote error={catalogue.error} onRetry={catalogue.reload} />
      ) : catalogue.initial ? (
        <Loading label="Reading the catalogue…" />
      ) : rows.length === 0 ? (
        <EmptyNote
          icon={Sparkles}
          title="No services yet"
          description="Add the first treatment and it appears on the public menu straight away."
          action={
            <Button onClick={() => setComposing(true)}>
              <Plus className="size-4" />
              New service
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((service) => {
            const busy = busyId === service.id;
            return (
              <li
                key={service.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-border/80 bg-card p-4 shadow-soft transition-opacity",
                  !service.isActive && "opacity-65",
                )}
              >
                <div className="min-w-[220px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-[16px] font-semibold leading-tight tracking-tight">
                      {service.name}
                    </p>
                    <Badge variant="outline">{CATEGORY_LABEL[service.category]}</Badge>
                    {service.subcategory && (
                      <Badge variant="champagne">{service.subcategory.name}</Badge>
                    )}
                    {!service.isActive && <Badge variant="destructive">Retired</Badge>}
                  </div>
                  {service.description && (
                    <p className="mt-1.5 line-clamp-2 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
                      {service.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="font-display text-[17px] font-semibold tabular-nums tracking-tight text-primary">
                      {peso(service.priceCents)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {minutesToLabel(service.durationMinutes)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(service)} disabled={busy}>
                      Edit
                    </Button>
                    {service.isActive ? (
                      <Button variant="ghost" size="sm" onClick={() => retire(service)} disabled={busy}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
                        Retire
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => restore(service)} disabled={busy}>
                        {busy ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <ArchiveRestore className="size-4" />
                        )}
                        Restore
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Create / edit
 * ------------------------------------------------------------------ */

function ServiceForm({
  service,
  groups,
  onSaved,
  onCancel,
}: {
  service: Service | null;
  groups: { category: ServiceCategory; subcategories: ServiceSubcategory[] }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState(service?.name ?? "");
  const [category, setCategory] = React.useState<ServiceCategory>(service?.category ?? "SPA");
  const [subcategoryId, setSubcategoryId] = React.useState<string>(service?.subcategory?.id ?? "");
  const [price, setPrice] = React.useState(service ? priceForInput(service.priceCents) : "");
  const [duration, setDuration] = React.useState(service ? String(service.durationMinutes) : "60");
  const [description, setDescription] = React.useState(service?.description ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [localErrors, setLocalErrors] = React.useState<Record<string, string>>({});

  // A group belongs to one category, so switching category must clear a stale
  // choice rather than submit a pair the API would reject.
  const availableGroups = groups.find((g) => g.category === category)?.subcategories ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "A name is required";

    const priceCents = parsePrice(price);
    if (priceCents === null) next.price = "Enter a price, e.g. 800 or 1200.50";

    const durationMinutes = Number(duration);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 720) {
      next.duration = "Between 5 and 720 minutes";
    }

    setLocalErrors(next);
    if (Object.keys(next).length || priceCents === null) return;

    const body: ServiceInput = {
      name: name.trim(),
      category,
      description: description.trim() || undefined,
      priceCents,
      durationMinutes,
      subcategoryId: subcategoryId || null,
    };

    setBusy(true);
    setError(null);
    try {
      if (service) await api.services.update(service.id, body);
      else await api.services.create(body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not save that service"));
    } finally {
      setBusy(false);
    }
  }

  const fieldErrors = { ...error?.fieldErrors, ...localErrors };

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-primary/25 bg-primary/[0.03] p-6"
      noValidate
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-[19px] font-semibold tracking-tight">
            {service ? "Edit service" : "New service"}
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {service
              ? "Saving changes what the public menu shows and what the desk charges."
              : "The service is bookable as soon as it is created — the menu reads live."}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="size-4" />
          Close
        </Button>
      </div>

      {error && <ErrorNote error={error} className="mt-4" />}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Combination Massage"
          error={fieldErrors.name}
        />
        <TextField
          label="Price (₱)"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="800"
          inputMode="decimal"
          error={fieldErrors.price ?? fieldErrors.priceCents}
          hint="Pesos. Stored to the centavo."
        />
        <TextField
          label="Duration (minutes)"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          placeholder="60"
          inputMode="numeric"
          error={fieldErrors.duration ?? fieldErrors.durationMinutes}
        />

        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Category
          </span>
          <div className="mt-1.5 flex gap-1.5">
            {CATEGORIES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setCategory(option);
                  setSubcategoryId("");
                }}
                aria-pressed={category === option}
                className={cn(
                  "h-10 flex-1 rounded-lg border text-[12.5px] font-medium transition-colors",
                  category === option
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/30",
                )}
              >
                {CATEGORY_LABEL[option]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="service-group"
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Menu group
          </label>
          <select
            id="service-group"
            value={subcategoryId}
            onChange={(e) => setSubcategoryId(e.target.value)}
            className="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-[13.5px] outline-none transition-colors focus:border-primary/40"
          >
            <option value="">No group — listed on the salon floor</option>
            {availableGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            How the public menu files it. Groups are per category.
          </p>
        </div>

        <div>
          <label
            htmlFor="service-description"
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Description
          </label>
          <textarea
            id="service-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What the treatment does, in the salon's own words."
            className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13.5px] leading-relaxed outline-none transition-colors focus:border-primary/40"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Shown on the menu card. {description.length}/2000
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Saving…
            </>
          ) : service ? (
            "Save changes"
          ) : (
            <>
              <Plus className="size-4" />
              Add to the menu
            </>
          )}
        </Button>
        <p className="text-[12px] text-muted-foreground">
          {service ? "Retire it instead if it is no longer offered." : "Retire it later; past bookings keep their record."}
        </p>
      </div>
    </form>
  );
}
