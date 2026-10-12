"use client";

/**
 * The frame for the public pages — the ones a visitor reaches without signing
 * in. Landing keeps its own bespoke chrome because it is a marketing page;
 * everything else shares this so the header does not have to be rewritten four
 * times and drift.
 *
 * The header is deliberately session-aware: a signed-in visitor gets a way
 * back into the console, an anonymous one gets a way in. That is the only
 * difference between the two states on a public page.
 */

import * as React from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, LogIn, LogOut, QrCode, Search, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AlleyMark, AlleySprig } from "@/components/brand/Logo";
import { homeFor, ROLE_LABEL, useAuth } from "@/auth/AuthProvider";

const NAV = [
  { to: "/services", label: "Services" },
  { to: "/book", label: "Book" },
  { to: "/scan", label: "Scan & check-in" },
];

export function PublicShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { status, me, role, logout } = useAuth();
  const navigate = useNavigate();
  const authed = status === "authenticated" && !!me;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-alley-900/10 bg-alley-900/95 backdrop-blur-md">
        <div className="container flex h-[70px] items-center gap-5">
          <Link to="/" className="flex shrink-0 items-center gap-3">
            <AlleyMark className="h-9 w-9 text-primary-foreground" />
            <span className="hidden flex-col leading-none sm:flex">
              <span className="font-display text-[17px] font-semibold tracking-tight text-primary-foreground">
                The Beauty Alley
              </span>
              <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.24em] text-primary-foreground/50">
                Downtown Atelier
              </span>
            </span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-full px-3.5 py-2 text-[13px] transition-colors",
                    isActive
                      ? "bg-white/10 text-primary-foreground"
                      : "text-primary-foreground/65 hover:bg-white/[0.06] hover:text-primary-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {authed ? (
              <>
                <span className="hidden items-center gap-2.5 rounded-full border border-white/15 py-1 pl-1 pr-3 lg:flex">
                  <span className="flex size-7 items-center justify-center rounded-full bg-champagne-400 text-[10.5px] font-semibold text-accent-foreground">
                    {(me.fullName ?? me.email ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex flex-col leading-none">
                    <span className="text-[11.5px] font-semibold text-primary-foreground">
                      {me.fullName ?? me.email}
                    </span>
                    <span className="text-[9.5px] text-primary-foreground/50">
                      {role ? ROLE_LABEL[role] : ""}
                    </span>
                  </span>
                </span>
                <Button asChild size="sm" variant="champagne" className="h-9">
                  <Link to={role ? homeFor(role) : "/app"}>
                    <LayoutDashboard className="size-4" />
                    Console
                  </Link>
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Sign out"
                  className="text-primary-foreground/70 hover:bg-white/10 hover:text-primary-foreground"
                  onClick={async () => {
                    await logout();
                    navigate("/");
                  }}
                >
                  <LogOut className="size-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground"
                >
                  <Link to="/login">
                    <LogIn className="size-4" />
                    Sign in
                  </Link>
                </Button>
                <Button asChild size="sm" variant="champagne" className="h-9 px-5">
                  <Link to="/book">Book now</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className={cn("flex-1", className)}>{children}</main>

      <footer className="border-t border-border/70 bg-sand-50">
        <div className="container grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3">
              <AlleyMark className="h-10 w-10 text-primary" />
              <span className="font-display text-[19px] font-semibold tracking-tight">
                The Beauty Alley
              </span>
            </div>
            <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
              A downtown atelier for hair, skin, nails and body — run on one
              quietly exact system.
            </p>
          </div>

          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Visit
            </h3>
            <ul className="mt-4 space-y-2.5 text-[13px]">
              <li>
                <Link to="/services" className="inline-flex items-center gap-1.5 text-foreground/75 transition-colors hover:text-primary">
                  <Search className="size-3.5" /> Services & pricing
                </Link>
              </li>
              <li>
                <Link to="/book" className="inline-flex items-center gap-1.5 text-foreground/75 transition-colors hover:text-primary">
                  <Sparkles className="size-3.5" /> Book an appointment
                </Link>
              </li>
              <li>
                <Link to="/scan" className="inline-flex items-center gap-1.5 text-foreground/75 transition-colors hover:text-primary">
                  <QrCode className="size-3.5" /> Arrive & scan
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              For the team
            </h3>
            <ul className="mt-4 space-y-2.5 text-[13px]">
              <li>
                <Link to="/login" className="text-foreground/75 transition-colors hover:text-primary">
                  Staff sign in
                </Link>
              </li>
              <li>
                <Link to="/register" className="text-foreground/75 transition-colors hover:text-primary">
                  Create a client account
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border/70">
          <div className="container flex flex-wrap items-center justify-between gap-3 py-6 text-[12px] text-muted-foreground">
            <p>© 2026 The Beauty Alley. All rights reserved.</p>
            <p className="font-display text-[13px] italic">Crafted with care, downtown.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** The band a public page opens with. */
export function PageHead({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lede?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="grain relative overflow-hidden bg-alley-900 pb-14 pt-14 text-primary-foreground">
      <AlleySprig className="pointer-events-none absolute -right-20 -top-16 h-[380px] w-[300px] text-white/[0.05]" />
      <div className="container relative">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-champagne-300">
          {eyebrow}
        </p>
        <h1 className="mt-4 font-display text-[clamp(2.1rem,4.6vw,3.2rem)] font-medium leading-[1.04] tracking-tight text-balance">
          {title}
        </h1>
        {lede && (
          <p className="mt-4 max-w-2xl text-[14.5px] leading-relaxed text-primary-foreground/65 text-pretty">
            {lede}
          </p>
        )}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}
