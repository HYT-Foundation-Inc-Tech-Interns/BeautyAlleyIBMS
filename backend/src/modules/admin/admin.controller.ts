import type { Request, Response } from "express";
import { adminService } from "./admin.service";
import { branchDay } from "../../lib/dates";

export const adminController = {
  async dashboard(req: Request, res: Response) {
    const { from, to } = req.query as unknown as { from: string; to: string };
    const result = await adminService.dashboard(from, to);
    res.status(200).json({ data: result });
  },

  async listClients(req: Request, res: Response) {
    const result = await adminService.listClients(req.query as never);
    res.status(200).json(result);
  },

  async getClient(req: Request, res: Response) {
    const result = await adminService.getClient(req.params.id);
    res.status(200).json({ data: result });
  },

  async updateClient(req: Request, res: Response) {
    const result = await adminService.updateClient(req.params.id, req.body);
    res.status(200).json({ data: result });
  },

  async removeClient(req: Request, res: Response) {
    const result = await adminService.deactivateClient(req.params.id);
    res.status(200).json({ data: result });
  },

  async exportClients(req: Request, res: Response) {
    const csv = await adminService.exportClientsCsv();
    const stamp = new Date().toISOString().slice(0, 10);
    res
      .status(200)
      .setHeader("Content-Type", "text/csv; charset=utf-8")
      .setHeader("Content-Disposition", `attachment; filename="clients-${stamp}.csv"`)
      // The BOM makes Excel open UTF-8 correctly instead of mangling accented
      // names - a small thing that otherwise generates a support ticket.
      .send("\uFEFF" + csv);
  },

  async staffLogins(_req: Request, res: Response) {
    const result = await adminService.unlinkedStaffLogins();
    res.status(200).json({ data: result });
  },

  async listAuditLogs(req: Request, res: Response) {
    const result = await adminService.listAuditLogs(req.query as never);
    res.status(200).json(result);
  },

  async insights(req: Request, res: Response) {
    const { days, minDays } = req.query as unknown as { days: number; minDays: number };
    const to = branchDay();
    const start = new Date(to + "T00:00:00Z");
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const from = start.toISOString().slice(0, 10);
    const result = await adminService.insights(from, to, minDays);
    res.status(200).json({ data: result });
  },
};
