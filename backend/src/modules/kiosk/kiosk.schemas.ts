import { z } from "zod";
import { PIN_PATTERN } from "../../lib/staffPin";

/**
 * A device label is what the owner calls the screen - "Front door", "Back
 * table". It is not an identifier: ids are uuids, and a duplicate label is
 * allowed, because two doors can both be called "Door" and refusing that would
 * make the owner invent names to satisfy a validator.
 *
 * The 60-character cap matches the CHECK constraint in migration 57. Trimming
 * here means a label of spaces is rejected as empty rather than reaching the
 * database to fail on a constraint.
 */
export const createKioskDeviceSchema = z.object({
  label: z.string().trim().min(1, "Give the device a name").max(60, "Keep the name under 60 characters"),
});

export type CreateKioskDeviceInput = z.infer<typeof createKioskDeviceSchema>;

export const kioskDeviceParamSchema = z.object({
  id: z.string().uuid("Not a device id"),
});

/**
 * A scanned pass, as the tablet hands it over.
 *
 * The bound is generous because the pass may arrive as a full URL rather than
 * the token - a phone's camera app opens the link instead of decoding the
 * payload. Unwrapping it is `lib/arrival`'s job; this only rejects the empty
 * and the absurd.
 */
const passField = z.string().trim().min(10, "Scan a pass to continue").max(2048);

export const kioskLookupSchema = z.object({ pass: passField });

/**
 * Admission. The PIN is checked before the pass is parsed, so the two are
 * required together: there is no endpoint that redeems a pass without one.
 */
export const kioskCheckInSchema = z.object({
  pass: passField,
  pin: z.string().regex(PIN_PATTERN, "A PIN is 4 to 6 digits"),
});
