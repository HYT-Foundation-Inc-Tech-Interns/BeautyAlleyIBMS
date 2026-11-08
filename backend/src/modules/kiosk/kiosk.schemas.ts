import { z } from "zod";

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
