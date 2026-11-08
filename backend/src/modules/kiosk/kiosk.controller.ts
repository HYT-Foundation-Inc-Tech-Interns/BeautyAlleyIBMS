import type { Request, Response } from "express";
import { kioskService } from "./kiosk.service";

export const kioskController = {
  /**
   * Who am I, from the device's own point of view.
   *
   * The kiosk screen calls this on boot: a 200 means the token works and gives
   * it the label to show; a 401 means someone has to come and re-provision it.
   * Returning only the identity - not the device list, not the branch - keeps
   * a screen by the door from being a way to enumerate the salon's hardware.
   */
  async me(req: Request, res: Response) {
    res.status(200).json({ data: req.kiosk });
  },

  async listDevices(_req: Request, res: Response) {
    const devices = await kioskService.listDevices();
    res.status(200).json({ data: devices });
  },

  async createDevice(req: Request, res: Response) {
    const result = await kioskService.createDevice(req.body, req.actor!);
    res.status(201).json({ data: result });
  },

  async revokeDevice(req: Request, res: Response) {
    const device = await kioskService.revokeDevice(req.params.id, req.actor!);
    res.status(200).json({ data: device });
  },
};
