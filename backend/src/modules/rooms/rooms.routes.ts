import { Router } from "express";
import { roomsController } from "./rooms.controller";
import {
  availableRoomsQuerySchema,
  createRoomSchema,
  idParamSchema,
  listRoomsQuerySchema,
  updateRoomSchema,
} from "./rooms.schemas";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";

export const roomsRouter = Router();

// --- public ----------------------------------------------------------------
// The floor plan is not a secret - the booking page shows which rooms a
// treatment uses - but it is also not something the API needs to publish in
// full. This returns active rooms only, no notes, and is the one room route
// reachable without a token.
roomsRouter.get("/public", asyncHandler(roomsController.listPublic));

// --- staff -----------------------------------------------------------------
// The desk manages occupancy, so it needs the full list and the availability
// preview. Read-only: creating or decommissioning a room is an ADMIN decision.
const staff = [authenticate, requireRole("STAFF", "ADMIN")] as const;
const admin = [authenticate, requireRole("ADMIN")] as const;

roomsRouter.get(
  "/available",
  ...staff,
  validate({ query: availableRoomsQuerySchema }),
  asyncHandler(roomsController.available)
);
roomsRouter.get("/", ...staff, validate({ query: listRoomsQuerySchema }), asyncHandler(roomsController.list));
roomsRouter.get("/:id", ...staff, validate({ params: idParamSchema }), asyncHandler(roomsController.getById));

// --- admin -----------------------------------------------------------------
roomsRouter.post("/", ...admin, validate({ body: createRoomSchema }), asyncHandler(roomsController.create));
roomsRouter.patch(
  "/:id",
  ...admin,
  validate({ params: idParamSchema, body: updateRoomSchema }),
  asyncHandler(roomsController.update)
);
roomsRouter.delete("/:id", ...admin, validate({ params: idParamSchema }), asyncHandler(roomsController.remove));
