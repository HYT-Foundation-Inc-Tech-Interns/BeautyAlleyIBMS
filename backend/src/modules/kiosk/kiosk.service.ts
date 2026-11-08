import { createDeviceSecret, formatKioskToken } from "../../lib/kioskToken";
import { admissionBlocker, arrivalState, verifyArrivalPass } from "../../lib/arrival";
import { pinLookup } from "../../lib/staffPin";
import { iso } from "../../lib/dates";
import { AppError, CODES } from "../../lib/errors";
import { settingsService } from "../settings/settings.service";
import { bookingsService } from "../bookings/bookings.service";
import { kioskRepository, type KioskDeviceDto } from "./kiosk.repository";
import type { CreateKioskDeviceInput } from "./kiosk.schemas";
import type { Actor, KioskIdentity } from "../../types/actor";

/**
 * Issuing a device.
 *
 * The order in `create` is the whole security property: mint the secret, hash
 * it, insert the hash, and only then assemble the token from the id the row
 * generated. If the insert fails there is no token, and the secret that was
 * never stored is simply discarded.
 *
 * `token` is returned exactly once. There is no endpoint that shows it again,
 * because the database cannot: it holds a digest, and that is the point.
 */
export const kioskService = {
  listDevices(): Promise<KioskDeviceDto[]> {
    return kioskRepository.list();
  },

  async createDevice(
    input: CreateKioskDeviceInput,
    actor: Actor
  ): Promise<{ device: KioskDeviceDto; token: string }> {
    const { secret, hash } = createDeviceSecret();
    const device = await kioskRepository.create(input.label, hash, actor.id);

    return { device, token: formatKioskToken(device.id, secret) };
  },

  revokeDevice(id: string, actor: Actor): Promise<KioskDeviceDto> {
    return kioskRepository.revoke(id, actor.id);
  },

  /**
   * Who is at the door, and what is stopping them.
   *
   * No PIN here. The pass itself is the credential - it is signed, so it cannot
   * be guessed or enumerated, and it already belongs to the guest holding it.
   * Requiring a PIN to *look* would mean a stylist typing one before they know
   * who they are looking at, which is backwards.
   *
   * `blocked` is the screen's whole job: it turns "the button would fail" into
   * a sentence. The server re-checks every one of these on admission, so this
   * is a prediction rather than a gate.
   */
  async lookup(input: { pass: string }) {
    const { jti } = verifyArrivalPass(input.pass);
    const [arrival, rules] = await Promise.all([
      kioskRepository.arrival(jti),
      settingsService.getBookingRules(),
    ]);

    const state = arrivalState(arrival.startTime, arrival.endTime, rules.arrivalWindowMinutes);
    const blocked = admissionBlocker(arrival, state);

    return {
      reference: arrival.reference,
      guestName: arrival.guestName,
      staffName: arrival.staffName,
      services: arrival.services,
      startTime: iso(arrival.startTime),
      endTime: iso(arrival.endTime),
      window: state,
      /** Null when the guest can be admitted now. */
      blocked,
      arrivalWindowMinutes: rules.arrivalWindowMinutes,
    };
  },

  /**
   * Admit a guest.
   *
   * The PIN is checked first, and deliberately so: a wrong PIN must cost the
   * caller nothing but a wait, and must tell them nothing about whether the
   * pass in their hand is real. Only once the PIN is good is the pass parsed,
   * the deposit checked and the booking redeemed.
   *
   * `force` is never passed. The door has no way to ask a human "are you sure",
   * and an override nobody decided is worse than a refusal - an early guest is
   * sent to reception, which is where a human can make that call.
   */
  async checkIn(input: { pass: string; pin: string }, kiosk: KioskIdentity) {
    const lookup = pinLookup(input.pin);
    const verdict = await kioskRepository.verifyPin(kiosk.id, lookup);

    if (!verdict.ok) {
      if (verdict.reason === "LOCKED") {
        throw new AppError(
          429,
          CODES.KIOSK_PIN_LOCKED,
          "Too many wrong PINs at this screen. Please wait before trying again.",
          { retryAfterSeconds: verdict.retryAfterSeconds }
        );
      }
      if (verdict.reason === "INACTIVE") {
        throw AppError.forbidden(
          CODES.KIOSK_PIN_INACTIVE,
          "That PIN belongs to someone who is no longer active. See the front desk."
        );
      }
      throw new AppError(401, CODES.KIOSK_PIN_INVALID, "That PIN was not recognised.", {
        attemptsLeft: verdict.attemptsLeft,
      });
    }

    const result = await bookingsService.checkIn({
      pass: input.pass,
      // A device is not a person: there is no session to record, and inventing
      // one would put a fake account in the audit trail.
      actor: null,
      kioskId: kiosk.id,
      staffId: verdict.employeeId,
    });

    return { ...result, staffName: verdict.fullName };
  },
};
