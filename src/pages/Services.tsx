"use client";

/**
 * The public catalogue.
 *
 * Search and the category filter are served by two different endpoints, and
 * that shapes the page: `/services/search` matches on a term but has no
 * category parameter, while `/services` filters by category but has no term.
 * So a term goes to `search` and the category is applied to the result set
 * here. The alternative — a term query and a category query fetched together
 * and intersected — would be two round trips to answer one question.
 *
 * Nothing on this page needs an account. That is the point of it: a visitor
 * deciding what to book should not have to register to find out what a facial
 * costs.
 */

import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Clock3, Search, Sparkles, X } from "lucide-react";

import { cn, minutesToLabel, peso } from "@/lib/utils";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { SERVICE_CATEGORIES, type Service, type ServiceCategory } from "@/lib/api-types";
import { serviceImage } from "@/lib/service-images";
import { Button } from "@/components/ui/button";
import { CategoryBadge, EmptyNote, ErrorNote, Loading, PersonAvatar } from "@/components/app/api-bits";
import { PageHead, PublicShell } from "@/components/app/PublicShell";

type Filter = ServiceCategory | "ALL";

/** Also the allow-list that stops a bad `?category=` in the URL breaking the page. */
const CATEGORY_FILTERS: Filter[] = ["ALL", ...SERVICE_CATEGORIES];

const CATEGORY_LABEL: Record<Filter, string> = {
  ALL: "Everything",
  SPA: "Spa",
  SALON: "Salon",
  WELLNESS: "Wellness",
};

/** Keeps a keystroke from spending a request. */
function useDebounced<T>(value: T, ms = 280) {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

function ServiceCard({ service }: { service: Service }) {
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-soft transition-[box-shadow,transform,border-color] duration-500 ease-out-quart hover:-translate-y-1 hover:border-primary/25 hover:shadow-lift">
      <div className="aspect-[4/3] overflow-hidden bg-sand-100">
        <img
          src={serviceImage(service)}
          alt={service.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-700 ease-out-quart group-hover:scale-[1.04]"
        />
      </div>

      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-center justify-between gap-3">
          <CategoryBadge category={service.category} />
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Clock3 className="size-3.5" />
            {minutesToLabel(service.durationMinutes)}
          </span>
        </div>

        <h3 className="mt-5 font-display text-[21px] font-semibold leading-tight tracking-tight">
          {service.name}
        </h3>
        {service.description && (
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {service.description}
          </p>
        )}

        <div className="mt-auto flex items-end justify-between gap-4 pt-6">
          <span className="font-display text-[25px] font-semibold tracking-tight text-primary">
            {peso(service.priceCents)}
          </span>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to={`/book?service=${service.id}`}>
              Book
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

export default function Services() {
  const [params, setParams] = useSearchParams();

  const requested = (params.get("category") as Filter | null) ?? "ALL";
  const [category, setCategory] = React.useState<Filter>(
    CATEGORY_FILTERS.includes(requested) ? requested : "ALL",
  );
  const [term, setTerm] = React.useState(params.get("q") ?? "");
  const q = useDebounced(term);

  const services = useAsync(`services:${q}:${category}`, async () => {
    const needle = q.trim();
    if (needle) {
      const hits = await api.services.search(needle, 50);
      return category === "ALL" ? hits : hits.filter((s) => s.category === category);
    }
    const page = await api.services.list({
      category: category === "ALL" ? undefined : category,
      limit: 100,
    });
    return page.data;
  });

  const team = useAsync("services:team", async () => (await api.employees.list({ limit: 50 })).data);

  // Keep the URL in step with the filters, so a filtered view can be shared or
  // reloaded. `replace` because a filter tweak is not a navigation the back
  // button should have to walk through one by one.
  React.useEffect(() => {
    const next = new URLSearchParams();
    if (q.trim()) next.set("q", q.trim());
    if (category !== "ALL") next.set("category", category);
    setParams(next, { replace: true });
  }, [q, category, setParams]);

  return (
    <PublicShell>
      <PageHead
        eyebrow="The Menu"
        title={
          <>
            Spa, salon and wellness —
            <span className="italic text-champagne-300"> priced plainly.</span>
          </>
        }
        lede="Search the full catalogue, or narrow it to one kind of treatment. Prices are final; no surprises at the desk."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-primary-foreground/50" />
            <input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Massage, facial, manicure…"
              aria-label="Search services"
              className="h-12 w-full rounded-full border border-white/20 bg-white/[0.07] pl-11 pr-11 text-[14px] text-primary-foreground outline-none transition-colors placeholder:text-primary-foreground/45 focus:border-champagne-400/60 focus:bg-white/[0.1]"
            />
            {term && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-primary-foreground/60 transition-colors hover:bg-white/10 hover:text-primary-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCategory(option)}
                aria-pressed={category === option}
                className={cn(
                  "rounded-full border px-4 py-2 text-[12.5px] font-medium transition-colors",
                  category === option
                    ? "border-champagne-400 bg-champagne-400 text-accent-foreground"
                    : "border-white/20 text-primary-foreground/70 hover:border-white/40 hover:text-primary-foreground",
                )}
              >
                {CATEGORY_LABEL[option]}
              </button>
            ))}
          </div>
        </div>
      </PageHead>

      <section className="container py-14">
        {services.error ? (
          <ErrorNote error={services.error} onRetry={services.reload} />
        ) : services.initial ? (
          <Loading label="Fetching the catalogue…" />
        ) : services.data && services.data.length > 0 ? (
          <>
            <p className="mb-6 text-[12.5px] text-muted-foreground">
              {services.data.length} service{services.data.length === 1 ? "" : "s"}
              {q.trim() && (
                <>
                  {" "}
                  matching <span className="text-foreground">“{q.trim()}”</span>
                </>
              )}
              {category !== "ALL" && <> in {CATEGORY_LABEL[category]}</>}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {services.data.map((service) => (
                <ServiceCard key={service.id} service={service} />
              ))}
            </div>
          </>
        ) : (
          <EmptyNote
            icon={Search}
            title="Nothing matches that"
            description={
              q.trim()
                ? `No service matches “${q.trim()}”${category !== "ALL" ? ` in ${CATEGORY_LABEL[category]}` : ""}. Try a shorter word, or clear the filters.`
                : "The catalogue is empty for this filter."
            }
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setTerm("");
                  setCategory("ALL");
                }}
              >
                Clear filters
              </Button>
            }
          />
        )}
      </section>

      {/* ------------------------------------------------------------ team */}
      <section className="border-t border-border/70 bg-sand-50">
        <div className="container py-14">
          <p className="eyebrow">The floor</p>
          <h2 className="mt-3 font-display text-[clamp(1.7rem,3vw,2.3rem)] font-medium leading-tight tracking-tight">
            Who will be looking after you.
          </h2>

          {team.error ? (
            <ErrorNote error={team.error} onRetry={team.reload} className="mt-8" />
          ) : team.initial ? (
            <Loading label="Fetching the team…" className="mt-8" />
          ) : team.data && team.data.length > 0 ? (
            <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {team.data.map((person) => (
                <div
                  key={person.id}
                  className="flex items-start gap-4 rounded-xl border border-border/80 bg-card p-5 shadow-soft"
                >
                  <PersonAvatar name={person.fullName} className="size-11 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-display text-[17px] font-semibold leading-tight tracking-tight">
                      {person.fullName}
                    </p>
                    {person.title && (
                      <p className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-primary">
                        <Sparkles className="size-3" />
                        {person.title}
                      </p>
                    )}
                    {person.bio && (
                      <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                        {person.bio}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyNote
              icon={Sparkles}
              title="No one on the roster yet"
              description="The team list is empty in the database."
              className="mt-8"
            />
          )}
        </div>
      </section>

      <section className="container py-14">
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-border/80 bg-card px-8 py-9 shadow-soft">
          <div className="max-w-lg">
            <h2 className="font-display text-[clamp(1.5rem,2.6vw,2rem)] font-medium leading-tight tracking-tight">
              Found something you like?
            </h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
              Pick a time and we'll hold the chair. You'll get an arrival pass
              straight away — no account needed.
            </p>
          </div>
          <Button asChild size="lg" className="h-12">
            <Link to="/book">
              Book an appointment
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>
    </PublicShell>
  );
}
