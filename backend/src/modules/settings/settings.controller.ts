import type { Request, Response } from "express";
import { settingsService } from "./settings.service";

export const settingsController = {
  async getPayments(_req: Request, res: Response) {
    const result = await settingsService.getPaymentProviders();
    res.status(200).json({ data: result });
  },

  async updatePayments(req: Request, res: Response) {
    const result = await settingsService.updatePaymentProviders(req.body, req.actor!);
    res.status(200).json({ data: result });
  },

  async getBooking(req: Request, res: Response) {
    const result = await settingsService.getBookingRules();
    res.status(200).json({ data: result });
  },

  /**
   * Public policy. Deliberately returns only the two numbers, not the audit
   * fields, and never the payment configuration.
   */
  async getPublicPolicy(_req: Request, res: Response) {
    const rules = await settingsService.getBookingRules();
    res.status(200).json({
      data: {
        cancellationWindowHours: rules.cancellationWindowHours,
        arrivalWindowMinutes: rules.arrivalWindowMinutes,
      },
    });
  },

  async updateBooking(req: Request, res: Response) {
    const result = await settingsService.updateBookingRules(req.body, req.actor!);
    res.status(200).json({ data: result });
  },

  async getReminders(_req: Request, res: Response) {
    const result = await settingsService.getReminderStatus();
    res.status(200).json({ data: result });
  },

  async testReminder(req: Request, res: Response) {
    const result = await settingsService.sendTestReminder(req.actor!);
    res.status(200).json({ data: result });
  },

  async getDeposits(_req: Request, res: Response) {
    const result = await settingsService.getDepositPolicy();
    res.status(200).json({ data: result });
  },

  async updateDeposits(req: Request, res: Response) {
    const result = await settingsService.updateDepositPolicy(req.body, req.actor!);
    res.status(200).json({ data: result });
  },
};
