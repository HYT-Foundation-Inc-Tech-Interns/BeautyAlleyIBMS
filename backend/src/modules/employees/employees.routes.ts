import { Router } from "express";
import { employeesController } from "./employees.controller";
import {
  availabilityQuerySchema,
  createEmployeeSchema,
  idParamSchema,
  leaveDecisionSchema,
  leaveParamSchema,
  leaveQuerySchema,
  listEmployeesSchema,
  performanceQuerySchema,
  quotaQuerySchema,
  setEmployeeServicesSchema,
  setStaffPinSchema,
  setWorkingHoursSchema,
  timeOffSchema,
  updateEmployeeSchema,
} from "./employees.schemas";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { OPERATIONS, DESK, OWNER } from "../../lib/roleGroups";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";

export const employeesRouter = Router();
export const availabilityRouter = Router();

// --- public ----------------------------------------------------------------
employeesRouter.get("/", validate({ query: listEmployeesSchema }), asyncHandler(employeesController.list));

// --- the quota board -------------------------------------------------------
// Declared BEFORE `/:id`. Express matches in declaration order, so a literal
// path has to come first or `/employees/quotas` is read as the id "quotas" and
// rejected by the uuid check with a 400. The same ordering is used for
// `/admin/clients/export.csv`, and `tests/unit/apiIndex.test.ts` walks this
// path for exactly that reason.
//
// DESK, not OPERATIONS: this is the whole floor's progress, which is what the
// front desk needs to know who is free. A stylist reads their own row through
// `/employees/:id/quota` instead.
employeesRouter.get(
  "/quotas",
  authenticate,
  requireRole(...DESK),
  validate({ query: quotaQuerySchema }),
  asyncHandler(employeesController.quotas)
);

/**
 * The leave board. Declared before `/:id` for the same reason as /quotas:
 * "leave" would otherwise be read as an id and rejected by the uuid check.
 *
 * DESK, not OWNER: reception is who gets told "Ana is off Thursday" at the
 * door, and the board is a read. Approving stays with the owner.
 */
employeesRouter.get(
  "/leave",
  authenticate,
  requireRole(...DESK),
  validate({ query: leaveQuerySchema }),
  asyncHandler(employeesController.leaveBoard)
);

employeesRouter.get("/:id", validate({ params: idParamSchema }), asyncHandler(employeesController.getById));

// --- admin -----------------------------------------------------------------
// Employee records, qualifications, rotas and leave: the owner's. A concierge
// works the desk, they do not hire or re-roster.
const admin = [authenticate, requireRole(...OWNER)] as const;

employeesRouter.post("/", ...admin, validate({ body: createEmployeeSchema }), asyncHandler(employeesController.create));
employeesRouter.patch(
  "/:id",
  ...admin,
  validate({ params: idParamSchema, body: updateEmployeeSchema }),
  asyncHandler(employeesController.update)
);
employeesRouter.delete("/:id", ...admin, validate({ params: idParamSchema }), asyncHandler(employeesController.remove));

employeesRouter.put(
  "/:id/services",
  ...admin,
  validate({ params: idParamSchema, body: setEmployeeServicesSchema }),
  asyncHandler(employeesController.setServices)
);

/*
 * The rota is read and written by the owner. The read is here because the
 * public `GET /employees/:id` omits `workingHours` on purpose - they are an
 * internal scheduling detail - and without it the editor had nothing to load.
 */
employeesRouter.get(
  "/:id/working-hours",
  ...admin,
  validate({ params: idParamSchema }),
  asyncHandler(employeesController.workingHours)
);

employeesRouter.put(
  "/:id/working-hours",
  ...admin,
  validate({ params: idParamSchema, body: setWorkingHoursSchema }),
  asyncHandler(employeesController.setWorkingHours)
);

/*
 * The door PIN.
 *
 * ADMIN in both directions, and the read is ADMIN too. A PIN is a way to admit
 * a guest, so "does this stylist have one" is a security-relevant fact rather
 * than roster data - the desk has no reason to know, and the public employee
 * shape never carries it.
 *
 * Three verbs rather than one PATCH with a nullable field: `DELETE` says "this
 * person has no PIN" without the caller having to know that absence is spelled
 * `null`, and it is idempotent, which is what the owner means by it.
 */
employeesRouter.get(
  "/:id/pin",
  ...admin,
  validate({ params: idParamSchema }),
  asyncHandler(employeesController.staffPin)
);

employeesRouter.put(
  "/:id/pin",
  ...admin,
  validate({ params: idParamSchema, body: setStaffPinSchema }),
  asyncHandler(employeesController.setStaffPin)
);

employeesRouter.delete(
  "/:id/pin",
  ...admin,
  validate({ params: idParamSchema }),
  asyncHandler(employeesController.clearStaffPin)
);

// Reading time off is useful to anyone who works here - a stylist wants to
// see their own leave, the desk wants to know who is out.
employeesRouter.get(
  "/:id/time-off",
  authenticate,
  requireRole(...OPERATIONS),
  validate({ params: idParamSchema }),
  asyncHandler(employeesController.listTimeOff)
);

/**
 * Ask for leave.
 *
 * OPERATIONS rather than OWNER, because the person who needs to ask is the
 * stylist. The service decides what the row means from the caller's role: the
 * owner's entry is approved on the spot, a stylist's is a pending request, and
 * a stylist can only ask for themselves. Keeping that rule in one place is why
 * the body carries no status.
 */
employeesRouter.post(
  "/:id/time-off",
  authenticate,
  requireRole(...OPERATIONS),
  validate({ params: idParamSchema, body: timeOffSchema }),
  asyncHandler(employeesController.requestTimeOff)
);

/** Answer a request. Approving the rota is the owner's call, not the desk's. */
employeesRouter.post(
  "/:id/time-off/:leaveId/decision",
  ...admin,
  validate({ params: leaveParamSchema, body: leaveDecisionSchema }),
  asyncHandler(employeesController.decideTimeOff)
);

/**
 * Withdraw a request. The service narrows it: a stylist may take back their
 * own pending request, the owner may remove any entry.
 */
employeesRouter.delete(
  "/:id/time-off/:leaveId",
  authenticate,
  requireRole(...OPERATIONS),
  validate({ params: leaveParamSchema }),
  asyncHandler(employeesController.cancelTimeOff)
);

/**
 * One stylist's progress against the daily completion quota.
 *
 * OPERATIONS: a stylist reads their own, the desk reads anyone's, and the
 * owner reads all. There is nothing private in it - a count of completed
 * clients is on the whiteboard anyway - and scoping it to "self only" would
 * mean the desk could not answer "has Bea finished her ten yet".
 */
employeesRouter.get(
  "/:id/quota",
  authenticate,
  requireRole(...OPERATIONS),
  validate({ params: idParamSchema, query: quotaQuerySchema }),
  asyncHandler(employeesController.quota)
);

employeesRouter.get(
  "/:id/performance",
  authenticate,
  requireRole(...OWNER),
  validate({ params: idParamSchema, query: performanceQuerySchema }),
  asyncHandler(employeesController.performance)
);

// --- availability (public) -------------------------------------------------
availabilityRouter.get(
  "/",
  validate({ query: availabilityQuerySchema }),
  asyncHandler(employeesController.availability)
);
