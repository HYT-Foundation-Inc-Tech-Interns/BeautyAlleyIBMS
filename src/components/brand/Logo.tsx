import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The Beauty Alley — brand furniture.
 *
 * This file used to also carry hand-drawn SVG "BA" monograms: a circle with a
 * B and an A in it, a ring of invented lettering, a pretend botanical crest.
 * They were placeholders that read as the salon's mark at a glance and as
 * something else entirely up close — which is exactly the failure mode a
 * logo must not have. The salon has a real crest, so every place that needs it
 * now renders `/brand/logo-emerald.png` or `/brand/logo-ivory.png` and this
 * file keeps only the ornament that was never pretending to be the mark.
 */

/* ------------------------------------------------------------------ *
 * Botanical flourish — used as a watermark and section divider.
 * ------------------------------------------------------------------ */

export function AlleySprig({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 240 320"
      aria-hidden="true"
      className={cn("h-64 w-48", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      {...props}
    >
      {/* stem */}
      <path d="M120 318 C 118 250, 108 200, 96 150 C 88 116, 84 84, 92 52" />
      {/* leaves along the stem */}
      <path d="M112 250 C 88 244, 66 228, 58 206 C 84 206, 106 220, 114 240" />
      <path d="M108 214 C 132 208, 156 192, 164 168 C 138 170, 116 186, 106 206" />
      <path d="M100 176 C 78 168, 60 150, 56 128 C 80 132, 98 148, 104 166" />
      <path d="M96 140 C 118 132, 138 116, 144 94 C 120 98, 102 112, 94 132" />
      {/* bloom */}
      <path d="M92 52 C 76 44, 66 28, 68 12 C 84 16, 94 32, 92 52 Z" />
      <path d="M92 52 C 104 40, 122 36, 136 42 C 126 56, 108 62, 92 52 Z" />
      <path d="M92 52 C 78 62, 60 64, 48 56 C 58 42, 78 40, 92 52 Z" />
      <path d="M92 52 C 96 34, 108 20, 124 16 C 124 34, 110 48, 92 52 Z" />
      <circle cx="92" cy="52" r="6" />
      {/* buds */}
      <path d="M120 300 C 138 296, 152 284, 156 268" />
      <circle cx="158" cy="264" r="5" />
      <path d="M132 296 C 150 296, 166 290, 176 278" />
      <circle cx="178" cy="274" r="4" />
    </svg>
  );
}
