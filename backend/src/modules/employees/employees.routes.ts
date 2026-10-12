import { Router } from "express";
import { employeesController } from "./employees.controller";
import {
  availabilityQuerySchema,
  createEmployeeSchema,
  idParamSchema,
  listEmployeesSchema,
  performanceQuerySchema,
  setEmployeeServicesSchema,
  setWorkingHoursSchema,
  timeOffSchema,
  updateEmployeeSchema,
} from "./employees.schemas";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";

export const employeesRouter = Router();
export const availabilityRouter = Router();

// --- public ----------------------------------------------------------------
employeesRouter.get("/", validate({ query: listEmployeesSchema }), asyncHandler(employeesController.list));
employeesRouter.get("/:id", validate({ params: idParamSchema }), asyncHandler(employeesController.getById));

// --- admin -----------------------------------------------------------------
const admin = [authenticate, requireRole("ADMIN")] as const;

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

employeesRouter.put(
  "/:id/working-hours",
  ...admin,
  validate({ params: idParamSchema, body: setWorkingHoursSchema }),
  asyncHandler(employeesController.setWorkingHours)
);

// Reading time off is useful to STAFF as well as ADMIN - a stylist wants to
// see their own leave. Writing it stays admin-only.
employeesRouter.get(
  "/:id/time-off",
  authenticate,
  requireRole("STAFF", "ADMIN"),
  validate({ params: idParamSchema }),
  asyncHandler(employeesController.listTimeOff)
);

employeesRouter.post(
  "/:id/time-off",
  ...admin,
  validate({ params: idParamSchema, body: timeOffSchema }),
  asyncHandler(employeesController.addTimeOff)
);

employeesRouter.get(
  "/:id/performance",
  authenticate,
  requireRole("ADMIN"),
  validate({ params: idParamSchema, query: performanceQuerySchema }),
  asyncHandler(employeesController.performance)
);

// --- availability (public) -------------------------------------------------
availabilityRouter.get(
  "/",
  validate({ query: availabilityQuerySchema }),
  asyncHandler(employeesController.availability)
);
