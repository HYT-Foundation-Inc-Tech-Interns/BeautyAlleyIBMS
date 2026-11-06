"use client";

/**
 * Arrivals — one door, two speeds.
 *
 * The salon had two screens for the same moment: `QR Check-in` (scan a pass and
 * commit immediately) and `Scan arrival pass` (scan, look at who it is, then
 * confirm). Staff had to know which one to open, and the nav offered both.
 *
 * This page keeps both behaviours but makes the choice explicit:
 *
 *   Scan & confirm   the careful path. The scan only looks the reservation up;
 *                    a second, deliberate tap records the arrival. Default,
 *                    because a mis-scan should not check in the wrong guest.
 *   Quick check-in   the desk's fast path, for the guest standing in front of
 *                    you with a pass already open. Same server endpoint.
 *
 * The mode lives in the query string so a link can point at the right one, and
 * the old routes redirect into it.
 */

import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { ScanLine, Zap } from "lucide-react";

import { PageHeader } from "@/components/app/bits";
import { cn } from "@/lib/utils";
import CheckIn from "./CheckIn";
import ScanArrivals from "./ScanArrivals";

type Mode = "confirm" | "quick";

const TABS: { id: Mode; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] = [
  {
    id: "confirm",
    label: "Scan & confirm",
    hint: "Look the guest up first, then record the arrival.",
    icon: ScanLine,
  },
  {
    id: "quick",
    label: "Quick check-in",
    hint: "The pass is already open — redeem it in one step.",
    icon: Zap,
  },
];

export default function Arrivals() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get("mode") === "quick" ? "quick" : "confirm";
  const active = TABS.find((t) => t.id === mode)!;

  function setMode(next: Mode) {
    const p = new URLSearchParams(params);
    p.set("mode", next);
    setParams(p, { replace: true });
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <PageHeader
        eyebrow="Front of house"
        icon={ScanLine}
        title="Arrivals"
        description="One door, two speeds. Scan a pass and confirm who it belongs to, or check in a guest whose pass is already in front of you."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Arrival mode"
          className="inline-flex w-full rounded-full border border-border bg-card p-1 shadow-soft sm:w-auto"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = tab.id === mode;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => setMode(tab.id)}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors sm:flex-none",
                  selected
                    ? "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <p className="text-[12px] leading-relaxed text-muted-foreground">{active.hint}</p>
      </div>

      {mode === "confirm" ? <ScanArrivals embedded /> : <CheckIn embedded />}
    </div>
  );
}
