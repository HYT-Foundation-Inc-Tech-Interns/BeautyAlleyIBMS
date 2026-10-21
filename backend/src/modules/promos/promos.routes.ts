import { Router } from "express";
import { promosController } from "./promos.controller";
import {
  createPromoSchema,
  idParamSchema,
  listPromosQuerySchema,
  reviewPromoSchema,
  updatePromoSchema,
  validatePromoSchema,
} from "./promos.schemas";
import { authenticate, optionalAuthenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";

export const promosRouter = Router();

// --- public ----------------------------------------------------------------
// Optional auth so a signed-in client's per-client redemption limit is counted
// correctly; a guest is identified by phone instead.
promosRouter.post(
  "/validate",
  optionalAuthenticate,
  validate({ body: validatePromoSchema }),
  asyncHandler(promosController.validate)
);

// --- the catalogue ---------------------------------------------------------
// The administrator reads every code; the desk reads the ones it proposed. The
// scope is applied in the service, never read from the query string.
const catalogue = [authenticate, requireRole("ADMIN", "CONCIERGE")] as const;

promosRouter.get(
  "/",
  ...catalogue,
  validate({ query: listPromosQuerySchema }),
  asyncHandler(promosController.list)
);

/**
 * Proposing a code.
 *
 * Both roles may call this, and the service decides what the row becomes: the
 * administrator's code is approved and live, the desk's is PENDING and inert
 * until it is reviewed.
 */
promosRouter.post(
  "/",
  ...catalogue,
  validate({ body: createPromoSchema }),
  asyncHandler(promosController.create)
);

// --- approval --------------------------------------------------------------
// The administrator alone approves or refuses a proposal.
const admin = [authenticate, requireRole("ADMIN")] as const;

promosRouter.post(
  "/:id/review",
  ...admin,
  validate({ params: idParamSchema, body: reviewPromoSchema }),
  asyncHandler(promosController.review)
);

promosRouter.get("/:id", ...admin, validate({ params: idParamSchema }), asyncHandler(promosController.getById));
promosRouter.patch(
  "/:id",
  ...admin,
  validate({ params: idParamSchema, body: updatePromoSchema }),
  asyncHandler(promosController.update)
);
promosRouter.delete("/:id", ...admin, validate({ params: idParamSchema }), asyncHandler(promosController.remove));
