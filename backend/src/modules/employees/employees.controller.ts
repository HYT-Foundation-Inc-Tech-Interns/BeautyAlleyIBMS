import type { Request, Response } from "express";
import { employeesService } from "./employees.service";
import type { ListEmployeesQuery } from "./employees.schemas";

export const employeesController = {
  /**
   * The public roster: active staff only.
   *
   * `includeInactive` is forced here rather than trusted from the query. The
   * schema no longer carries the key, so a request cannot set it - but the
   * repository switches to the service role when it is true, and that is a
   * switch an unauthenticated request must not be able to reach even if the
   * schema changes again later.
   */
  async list(req: Request, res: Response) {
    const result = await employeesService.list({
      ...(req.query as unknown as ListEmployeesQuery),
      includeInactive: false,
    });
    res.status(200).json(result);
  },

  /** The roster as the desk and the owner read it, deactivated staff included. */
  async adminList(req: Request, res: Response) {
    const result = await employeesService.list(req.query as never);
    res.status(200).json(result);
  },

  async getById(req: Request, res: Response) {
    const result = await employeesService.getById(req.params.id, true);
    res.status(200).json({ data: result });
  },

  async create(req: Request, res: Response) {
    const result = await employeesService.create(req.body, req.actor?.id ?? null);
    res.status(201).json({ data: result });
  },

  async update(req: Request, res: Response) {
    const result = await employeesService.update(req.params.id, req.body);
    res.status(200).json({ data: result });
  },

  async remove(req: Request, res: Response) {
    const result = await employeesService.deactivate(req.params.id);
    res.status(200).json({ data: result });
  },

  async setServices(req: Request, res: Response) {
    const result = await employeesService.setServices(req.params.id, req.body.serviceIds);
    res.status(200).json({ data: result });
  },

  async setWorkingHours(req: Request, res: Response) {
    const result = await employeesService.setWorkingHours(req.params.id, req.body.hours);
    res.status(200).json({ data: result });
  },

  async addTimeOff(req: Request, res: Response) {
    const { startsAt, endsAt, reason } = req.body;
    const result = await employeesService.addTimeOff(req.params.id, startsAt, endsAt, reason);
    res.status(201).json({ data: result });
  },

  async listTimeOff(req: Request, res: Response) {
    const result = await employeesService.timeOff(req.params.id);
    res.status(200).json({ data: result });
  },

  async performance(req: Request, res: Response) {
    const { from, to } = req.query as unknown as { from: string; to: string };
    const result = await employeesService.performance(req.params.id, from, to);
    res.status(200).json({ data: result });
  },

  async quota(req: Request, res: Response) {
    const { date } = req.query as unknown as { date?: string };
    const result = await employeesService.quota(req.params.id, date);
    res.status(200).json({ data: result });
  },

  async quotas(req: Request, res: Response) {
    const { date } = req.query as unknown as { date?: string };
    const result = await employeesService.quotas(date);
    res.status(200).json({ data: result });
  },

  async availability(req: Request, res: Response) {
    const q = req.query as unknown as {
      serviceId: string;
      date: string;
      employeeId?: string;
      intervalMinutes: number;
    };
    const result = await employeesService.availability({
      serviceId: q.serviceId,
      date: q.date,
      employeeId: q.employeeId,
      intervalMinutes: q.intervalMinutes,
    });
    res.status(200).json({ data: result });
  },
};
