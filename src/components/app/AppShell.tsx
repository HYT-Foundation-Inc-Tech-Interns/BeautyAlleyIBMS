"use client";

/**
 * The console shell.
 *
 * The footer used to hold a three-way role switcher: Owner / Worker / Client
 * buttons that changed who you were by clicking. That is gone. Who you are now
 * comes from a signed token and a live `profiles` row, and what you may open is
 * decided by `can()` from the auth provider — which mirrors the backend's own
 * `requireRole` map. Nothing here can promote you; the worst a tampered
 * `localStorage` can do is make the sidebar show an item that then 403s.
 */

import * as React from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  CalendarDays,
  ExternalLink,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  QrCode,
  Scissors,
  Tag,
  Ticket,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useAuth, type Area, ROLE_LABEL } from "@/auth/AuthProvider";

/* ------------------------------------------------------------------ */

interface NavItem {
  area: Area;
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Nav is written once for every role; `can()` decides what each one actually
 * sees. A CLIENT's whole console is the last group.
 */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Operate",
    items: [
      { area: "overview", to: "/app", label: "Overview", icon: LayoutDashboard },
      { area: "bookings", to: "/app/bookings", label: "Bookings", icon: CalendarDays },
      { area: "check-in", to: "/app/check-in", label: "QR Check-in", icon: QrCode },
    ],
  },
  {
    label: "Records",
    items: [
      { area: "clients", to: "/app/clients", label: "Clients", icon: Users },
      { area: "promos", to: "/app/promos", label: "Promo codes", icon: Tag },
      { area: "employees", to: "/app/team", label: "Employees", icon: Scissors },
    ],
  },
  {
    label: "Insight",
    items: [{ area: "board", to: "/app/board", label: "Monitoring Board", icon: LayoutGrid }],
  },
  {
    label: "You",
    items: [{ area: "my-bookings", to: "/app/my-bookings", label: "My bookings", icon: Ticket }],
  },
];

const TITLES: Record<string, { title: string; sub: string }> = {
  "/app": { title: "Overview", sub: "How the week is going" },
  "/app/bookings": { title: "Bookings", sub: "Reservations and chair schedule" },
  "/app/clients": { title: "Clients", sub: "Profiles, visits and retention" },
  "/app/promos": { title: "Promo codes", sub: "Discounts, caps and redemptions" },
  "/app/team": { title: "Employees", sub: "The floor and what they are qualified for" },
  "/app/check-in": { title: "QR Check-in", sub: "Redeem an arrival pass" },
  "/app/board": { title: "Monitoring Board", sub: "Drag to arrange your own view" },
  "/app/my-bookings": { title: "My bookings", sub: "Your appointments and passes" },
};

/* ------------------------------------------------------------------ *
 * Signed-in user
 * ------------------------------------------------------------------ */

function initialsOf(name: string | null, email: string | null) {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]!.toUpperCase());
  return letters.join("") || "?";
}

function UserMenu() {
  const { me, role, logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape — a menu that only closes by clicking
  // itself again is a small thing that feels broken.
  React.useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = me?.fullName || me?.email || "Signed in";

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-full border border-border/70 bg-card py-1 pl-1 pr-3 text-left transition-colors hover:bg-muted/60"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          {initialsOf(me?.fullName ?? null, me?.email ?? null)}
        </span>
        <span className="hidden flex-col leading-none lg:flex">
          <span className="max-w-[150px] truncate text-[12px] font-semibold">{label}</span>
          <span className="text-[10px] text-muted-foreground">
            {role ? ROLE_LABEL[role] : "—"}
          </span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-lift"
        >
          <div className="border-b border-border/60 px-3.5 py-3">
            <p className="truncate text-[13px] font-semibold">{label}</p>
            <p className="truncate text-[11.5px] text-muted-foreground">{me?.email}</p>
            <p className="mt-1.5 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold text-primary">
              {role ? ROLE_LABEL[role] : "—"}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12.5px] font-medium text-clay transition-colors hover:bg-clay/10"
          >
            <LogOut className="size-[15px]" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sidebar
 * ------------------------------------------------------------------ */

function AppSidebar() {
  const { can, me, role } = useAuth();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-0 p-3">
        <Link
          to="/"
          className="flex items-center gap-3 rounded-lg px-1.5 py-2 transition-colors hover:bg-white/[0.05]"
        >
          <img
            src="/brand/logo-ivory.png"
            alt="The Beauty Alley"
            width={1912}
            height={1912}
            className="h-14 w-14 shrink-0 object-contain drop-shadow-[0_2px_12px_rgba(7,25,20,0.45)]"
          />
          <span className="min-w-0 truncate font-display text-[19px] font-semibold tracking-tight text-primary-foreground group-data-[collapsible=icon]:hidden">
            The Beauty Alley
          </span>
        </Link>
      </SidebarHeader>

      <SidebarSeparator className="mx-4 my-1" />

      <SidebarContent className="gap-0 px-0 py-2">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => can(item.area));
          if (!items.length) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild tooltip={item.label}>
                        <NavLink
                          to={item.to}
                          end={item.to === "/app"}
                          className={({ isActive }) =>
                            cn(isActive && "bg-white/[0.12] text-primary-foreground")
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <item.icon
                                className={cn(
                                  "transition-colors",
                                  isActive
                                    ? "text-primary-foreground"
                                    : "text-primary-foreground/55",
                                )}
                              />
                              <span className="truncate">{item.label}</span>
                            </>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="gap-3 p-3">
        <div className="group-data-[collapsible=icon]:hidden">
          <p className="truncate px-1 text-[12.5px] font-semibold text-primary-foreground/90">
            {me?.fullName || me?.email || "Signed in"}
          </p>
          <p className="mt-0.5 px-1 text-[10.5px] leading-relaxed text-primary-foreground/45">
            {role ? ROLE_LABEL[role] : "—"} · permissions come from your account
          </p>
        </div>
        <Link
          to="/"
          className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] text-primary-foreground/60 transition-colors hover:bg-white/[0.07] hover:text-primary-foreground group-data-[collapsible=icon]:justify-center"
        >
          <ExternalLink className="size-[17px] shrink-0" />
          <span className="group-data-[collapsible=icon]:hidden">Back to public site</span>
        </Link>
      </SidebarFooter>
    </Sidebar>
  );
}

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

export function AppShell() {
  const { pathname } = useLocation();
  const { role } = useAuth();
  const heading =
    TITLES[pathname] ?? {
      title: "The Beauty Alley",
      sub: role ? ROLE_LABEL[role] : "",
    };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-[68px] items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <SidebarTrigger aria-label="Toggle navigation" />

          <div className="hidden min-w-0 flex-col sm:flex">
            <h1 className="truncate font-display text-[19px] font-semibold leading-tight tracking-tight">
              {heading.title}
            </h1>
            <p className="truncate text-[11.5px] text-muted-foreground">{heading.sub}</p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="hidden h-9 rounded-full md:inline-flex">
              <Link to="/book">New booking</Link>
            </Button>
            <UserMenu />
          </div>
        </header>

        <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default AppShell;
