import { Router } from "express";
import { kioskController } from "./kiosk.controller";
import { createKioskDeviceSchema, kioskDeviceParamSchema, kioskCheckInSchema, kioskLookupSchema } from "./kiosk.schemas";
import { authenticate } from "../../middleware/authenticate";
import { authenticateDevice } from "../../middleware/authenticateDevice";
import { requireRole } from "../../middleware/requireRole";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";
import { OWNER } from "../../lib/roleGroups";

/**
 * Two audiences, one mount point.
 *
 * `/kiosk/me` is answered to a **device**: its token is a `kiosk.<id>.<secret>`
 * string, not a session, so it goes through `authenticateDevice`.
 *
 * Everything under `/kiosk/devices` is answered to a **person** - the owner,
 * issuing and revoking screens - so it goes through `authenticate`. The two
 * are not interchangeable: a device token fails `authenticate` at the GoTrue
 * round trip, and a staff session fails `authenticateDevice` on the token
 * shape. Neither can reach the other's routes.
 */
export const kioskRouter = Router();

kioskRouter.get("/me", authenticateDevice, asyncHandler(kioskController.me));

/**
 * The arrival desk.
 *
 * Both routes are device-only. `lookup` needs nothing but the device token and
 * a pass - the pass is a signed credential the guest is holding, so looking it
 * up reveals only what its holder already has. `check-in` additionally needs a
 * staff PIN, which is what makes an admission attributable to a person.
 */
kioskRouter.post(
  "/lookup",
  authenticateDevice,
  validate({ body: kioskLookupSchema }),
  asyncHandler(kioskController.lookup)
);

kioskRouter.post(
  "/check-in",
  authenticateDevice,
  validate({ body: kioskCheckInSchema }),
  asyncHandler(kioskController.checkIn)
);

const owner = [authenticate, requireRole(...OWNER)] as const;

kioskRouter.get("/devices", ...owner, asyncHandler(kioskController.listDevices));

kioskRouter.post(
  "/devices",
  ...owner,
  validate({ body: createKioskDeviceSchema }),
  asyncHandler(kioskController.createDevice)
);

/**
 * POST rather than DELETE: the row is not removed. Revocation is a timestamp,
 * because "which screen admitted this guest" has to stay answerable after the
 * device is gone.
 */
kioskRouter.post(
  "/devices/:id/revoke",
  ...owner,
  validate({ params: kioskDeviceParamSchema }),
  asyncHandler(kioskController.revokeDevice)
);
