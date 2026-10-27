import { Router } from "express";
import { adminController } from "./admin.controller";
import {
  dashboardQuerySchema,
  idParamSchema,
  listAuditLogsQuerySchema,
  listClientsQuerySchema,
  updateClientSchema,
} from "./admin.schemas";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/requireRole";
import { DESK } from "../../lib/roleGroups";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../lib/asyncHandler";

// Reporting endpoints reuse the list controllers from the other modules rather
// than reimplementing them, so there is exactly one definition of "list
// bookings" in the codebase.
import { bookingsController } from "../bookings/bookings.controller";
import { employeesController } from "../employees/employees.controller";
import { promosController } from "../promos/promos.controller";
import { listBookingsQuerySchema } from "../bookings/bookings.schemas";
import { listEmployeesSchema } from "../employees/employees.schemas";
import { listPromosQuerySchema } from "../promos/promos.schemas";

export const adminRouter = Router();

adminRouter.use(authenticate);

/*
 * Two reports are read by the desk as well as the owner.
 *
 * The monitoring board draws revenue, the day's flow and the best clients from
 * these two, and the board is the concierge's screen as much as the
 * administrator's - the desk is the one who needs to see how the week is
 * going. Everything below the guard stays ADMIN: these are the only two
 * routes that are reads of an aggregate, and neither exposes a client's
 * record beyond the row the desk already reads in a booking.
 *
 * They are declared before the blanket guard on purpose: Express matches in
 * order, so a route registered above it never passes through it.
 */
adminRouter.get(
  "/dashboard",
  requireRole(...DESK),
  validate({ query: dashboardQuerySchema }),
  asyncHandler(adminController.dashboard)
);
adminRouter.get(
  "/clients",
  requireRole(...DESK),
  validate({ query: listClientsQuerySchema }),
  asyncHandler(adminController.listClients)
);

adminRouter.use(requireRole("ADMIN"));

// --- clients ---------------------------------------------------------------
// The literal route is declared before the parameterised one: Express matches
// in declaration order, so `/clients/export.csv` would otherwise be captured
// by `/clients/:id` and fail uuid validation.
adminRouter.get("/clients/export.csv", asyncHandler(adminController.exportClients));
adminRouter.get("/clients/:id", validate({ params: idParamSchema }), asyncHandler(adminController.getClient));
adminRouter.patch(
  "/clients/:id",
  validate({ params: idParamSchema, body: updateClientSchema }),
  asyncHandler(adminController.updateClient)
);
adminRouter.delete("/clients/:id", validate({ params: idParamSchema }), asyncHandler(adminController.removeClient));

// --- cross-module reporting ------------------------------------------------
adminRouter.get("/bookings", validate({ query: listBookingsQuerySchema }), asyncHandler(bookingsController.list));
adminRouter.get("/employees", validate({ query: listEmployeesSchema }), asyncHandler(employeesController.list));
adminRouter.get("/promos", validate({ query: listPromosQuerySchema }), asyncHandler(promosController.list));

// --- staff logins ----------------------------------------------------------
// The logins that are not attached to a roster row: what the Team page offers
// when the owner links an account to an employee record.
adminRouter.get("/staff-logins", asyncHandler(adminController.staffLogins));

// --- audit -----------------------------------------------------------------
adminRouter.get("/audit-logs", validate({ query: listAuditLogsQuerySchema }), asyncHandler(adminController.listAuditLogs));
