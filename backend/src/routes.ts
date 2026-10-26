import { Router } from "express";
import type { Request, Response } from "express";
import { authRouter, adminAuthRouter } from "./modules/auth/auth.routes";
import { servicesRouter } from "./modules/services/services.routes";
import { availabilityRouter, employeesRouter } from "./modules/employees/employees.routes";
import { bookingsRouter, meRouter } from "./modules/bookings/bookings.routes";
import { qrRouter } from "./modules/qr/qr.routes";
import { promosRouter } from "./modules/promos/promos.routes";
import { roomsRouter } from "./modules/rooms/rooms.routes";
import { subcategoriesRouter } from "./modules/subcategories/subcategories.routes";
import { loyaltyRouter } from "./modules/loyalty/loyalty.routes";
import { attendanceRouter } from "./modules/attendance/attendance.routes";
import { tasksRouter } from "./modules/tasks/tasks.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import { clientsRouter } from "./modules/clients/clients.routes";
import { buildApiIndex } from "./lib/apiIndex";

/**
 * The API surface, in one place.
 *
 * Everything is mounted under /api/v1 except /health, which lives at the root
 * so an uptime monitor does not need to know the version.
 */
export const apiRouter = Router();

// The version root answers with the same index as `/`, so a caller who guesses
// `/api/v1` is not left at another dead end.
apiRouter.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ data: buildApiIndex() });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/services", servicesRouter);
apiRouter.use("/employees", employeesRouter);
apiRouter.use("/availability", availabilityRouter);
apiRouter.use("/bookings", bookingsRouter);
apiRouter.use("/me", meRouter);
apiRouter.use("/qr", qrRouter);
apiRouter.use("/promos", promosRouter);
apiRouter.use("/rooms", roomsRouter);
apiRouter.use("/service-subcategories", subcategoriesRouter);
apiRouter.use("/loyalty", loyaltyRouter);
apiRouter.use("/attendance", attendanceRouter);
apiRouter.use("/tasks", tasksRouter);
apiRouter.use("/clients", clientsRouter);

/*
 * Order matters here, and it is not cosmetic.
 *
 * `adminRouter` opens with `use(authenticate, requireRole("ADMIN"))` - a
 * blanket gate over everything under /admin. Mounted first, it answers a
 * concierge with 403 before `adminAuthRouter` is ever consulted, so the
 * desk-only routes below were unreachable for the desk and only ever worked
 * for an administrator. Express runs middleware in mount order, so the
 * narrower router is mounted first and falls through when it has no match.
 */
apiRouter.use("/admin", adminAuthRouter);
apiRouter.use("/admin", adminRouter);
