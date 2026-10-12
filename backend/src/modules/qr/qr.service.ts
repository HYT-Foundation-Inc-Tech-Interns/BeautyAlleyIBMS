import { z } from "zod";
import { env } from "../../config/env";
import { bookingsService } from "../bookings/bookings.service";
import type { Actor } from "../../types/actor";

export const checkInSchema = z.object({
  /**
   * Either the full signed pass ("BA1.<body>.<sig>") or the URL the QR encodes.
   * Accepting both means a scanner that hands back the decoded URL works
   * without the client having to parse it first.
   */
  pass: z.string().trim().min(10, "A check-in pass is required").max(2048),
});

export const qrService = {
  /**
   * The desk's own QR code.
   *
   * This is the *static* one printed and mounted at the front desk - it points
   * at the check-in page. The per-booking passes are dynamic and live on
   * /bookings/:id/qr. Keeping the two apart matters: a static image cannot be
   * revoked, so it must never itself authorise anything.
   */
  branch() {
    return {
      label: "Beauty Alley - front desk",
      url: env.qrCheckInUrl,
      checkInWindowMinutes: env.qrCheckinWindowMinutes,
      // Stated explicitly so nobody later mistakes this for an access token.
      authorises: false,
    };
  },

  async checkIn(input: { pass: string }, actor: Actor) {
    // Tolerate a full URL: pull the `pass` query parameter back out if the
    // scanner decoded the QR into a link rather than a raw token.
    let pass = input.pass.trim();
    if (/^https?:\/\//i.test(pass)) {
      try {
        const url = new URL(pass);
        pass = url.searchParams.get("pass") ?? pass;
      } catch {
        /* not a URL after all - fall through and let the verifier reject it */
      }
    }
    return bookingsService.checkIn(pass, actor);
  },
};
