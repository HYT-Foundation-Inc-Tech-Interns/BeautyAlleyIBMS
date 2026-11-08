import type { Actor, KioskIdentity } from "./actor";

declare global {
  namespace Express {
    interface Request {
      /** Populated by the `authenticate` middleware. */
      actor?: Actor;
      /**
       * Populated by `authenticateDevice`. Never set alongside `actor`: a
       * kiosk is a screen, not a person, and code that reads `req.actor!`
       * must not be reachable with a device token.
       */
      kiosk?: KioskIdentity;
    }
  }
}

export {};
