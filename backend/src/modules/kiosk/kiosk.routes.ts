import { Router } from "express";
import { kioskController } from "./kiosk.controller";
import { createKioskDeviceSchema, kioskDeviceParamSchema } from "./kiosk.schemas";
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
