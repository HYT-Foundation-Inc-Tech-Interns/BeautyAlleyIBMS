"use client";

import * as React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import type { AppointmentStatus, Tier } from "@/data/salon";
import { TIER_META } from "@/data/salon";

/* ------------------------------------------------------------------ *
 * Change indicator — a number against a previous period, in words too.
 * ------------------------------------------------------------------ */

export function Delta({
  value,
  against,
  goodWhen = "up",
  suffix,
  className,
}: {
  value: number;
  against: string;
  goodWhen?: "up" | "down";
  suffix?: string;
  className?: string;
}) {
  const up = value >= 0;
  const good = up === (goodWhen === "up");
  const Icon = up ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[12.5px] font-medium tabular-nums",
        // Semantic, not brand: a rise that is *good* is green in either palette.
        good ? "text-success" : "text-destructive",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {Math.abs(value)}%
      {suffix && (
        <span className="font-normal text-muted-foreground">{suffix}</span>
      )}
      <span className="sr-only"> {against}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Avatars — initials on a deterministic brand tint. No stock photos.
 * ------------------------------------------------------------------ */

/*
 * Tints are tokens, not brand literals, so an avatar is emerald on the public
 * site and rosewood/champagne inside the console without a second list.
 */
const TINTS = [
  "bg-primary text-primary-foreground",
  "bg-primary/75 text-primary-foreground",
  "bg-accent text-accent-foreground",
  "bg-secondary text-secondary-foreground",
  "bg-muted-foreground text-background",
  "bg-accent/60 text-accent-foreground",
];

function tintFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function PersonAvatar({
  name,
  className,
  ring = false,
}: {
  name: string;
  className?: string;
  ring?: boolean;
}) {
  return (
    <Avatar
      className={cn(
        "size-9",
        ring && "ring-2 ring-background",
        className,
      )}
    >
      <AvatarFallback className={cn("text-[11px] font-semibold", tintFor(name))}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function AvatarStack({
  names,
  max = 3,
  className,
}: {
  names: string[];
  max?: number;
  className?: string;
}) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span className={cn("flex items-center", className)}>
      {shown.map((n, i) => (
        <PersonAvatar
          key={n}
          name={n}
          ring
          className={cn("size-6", i > 0 && "-ml-2")}
        />
      ))}
      {rest > 0 && (
        <span className="-ml-2 flex size-6 items-center justify-center rounded-full bg-muted text-[9.5px] font-semibold text-muted-foreground ring-2 ring-background">
          +{rest}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Domain pills
 * ------------------------------------------------------------------ */

const STATUS_META: Record<
  AppointmentStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "success" | "warning" | "destructive" }
> = {
  confirmed: { label: "Confirmed", variant: "outline" },
  "checked-in": { label: "Checked in", variant: "warning" },
  "in-service": { label: "In service", variant: "default" },
  completed: { label: "Completed", variant: "success" },
  "no-show": { label: "No-show", variant: "destructive" },
};

export function StatusPill({ status }: { status: AppointmentStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant={meta.variant} className="whitespace-nowrap">
      {meta.label}
    </Badge>
  );
}

export function TierBadge({ tier }: { tier: Tier }) {
  const meta = TIER_META[tier];
  return (
    <Badge variant={meta.variant} title={meta.blurb}>
      {tier}
    </Badge>
  );
}

/* ------------------------------------------------------------------ *
 * Section furniture
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Console page header
 *
 * Every record page opens with the same emerald band: a mark, the page's
 * name, one sentence about what the page is for, and its actions. The band
 * is the same surface as the dashboard hero, one size down, so the console
 * reads as one product rather than eight unrelated tables.
 * ------------------------------------------------------------------ */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  icon: Icon,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
}) {
  return (
    <section className="hero-surface hero-grid relative overflow-hidden rounded-2xl px-5 py-6 shadow-lift sm:px-7">
      <img
        src="/brand/logo-ivory.png"
        alt=""
        aria-hidden
        className="pointer-events-none absolute -right-8 top-1/2 hidden size-56 -translate-y-1/2 object-contain opacity-[0.06] lg:block"
      />
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-4">
          {Icon && (
            <span className="hidden size-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/[0.08] text-primary-foreground sm:flex">
              <Icon className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow text-primary-foreground/55">{eyebrow}</p>}
            <h1 className="mt-1.5 font-display text-[24px] font-semibold leading-tight tracking-tight text-primary-foreground sm:text-[27px]">
              {title}
            </h1>
            {description && (
              <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-primary-foreground/65 text-pretty">
                {description}
              </p>
            )}
            {children && <div className="mt-4">{children}</div>}
          </div>
        </div>

        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:mt-1 [&_[data-variant=default]]:bg-primary-foreground [&_[data-variant=default]]:text-sidebar [&_[data-variant=default]]:hover:bg-white [&_[data-variant=ghost]]:text-primary-foreground/75 [&_[data-variant=ghost]]:hover:bg-white/[0.12] [&_[data-variant=ghost]]:hover:text-primary-foreground [&_[data-variant=outline]]:border-white/15 [&_[data-variant=outline]]:bg-white/[0.08] [&_[data-variant=outline]]:text-primary-foreground [&_[data-variant=outline]]:hover:bg-white/[0.15] [&_[data-variant=secondary]]:bg-white/[0.14] [&_[data-variant=secondary]]:text-primary-foreground [&_[data-variant=secondary]]:hover:bg-white/[0.2]">
            {actions}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Stat tile — the small number card used under page headers.
 * ------------------------------------------------------------------ */

const TILE_TONES = {
  primary: "bg-primary/10 text-primary",
  accent: "bg-champagne-400/20 text-champagne-600",
  success: "bg-success/10 text-success",
  danger: "bg-destructive/10 text-destructive",
} as const;

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof TILE_TONES;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-soft transition-transform duration-300 ease-out-quart hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        {Icon && (
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full",
              TILE_TONES[tone],
            )}
          >
            <Icon className="size-3.5" />
          </span>
        )}
      </div>
      <p className="mt-2 font-display text-[22px] font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h2 className="font-display text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/80 bg-card shadow-soft",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary/[0.07] text-primary">
        <Icon className="size-5" />
      </span>
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** A quiet label/value pair for definition lists. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1.5 text-[13.5px] text-foreground">{children}</dd>
    </div>
  );
}
