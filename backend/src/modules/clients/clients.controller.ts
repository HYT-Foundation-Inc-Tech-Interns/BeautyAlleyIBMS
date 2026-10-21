import type { Request, Response } from "express";
import { clientsRepository } from "./clients.repository";

export const clientsController = {
  /**
   * `GET /clients/search?q=` — up to eight matches for the booking form.
   *
   * Two characters is the floor: one character matches most of the book, which
   * is neither useful to the desk nor cheap to compute.
   */
  async search(req: Request, res: Response) {
    const term = String(req.query.q ?? "").trim();
    if (term.length < 2) {
      res.status(200).json({ data: [] });
      return;
    }

    const rows = await clientsRepository.search(term, 8);
    res.status(200).json({
      data: rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        phone: row.phone,
        email: row.email,
      })),
    });
  },
};
