import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import type { Request } from "express";
import { env } from "../config/env";
import { CODES } from "../lib/errors";

/**
 * Rate limiters.
 *
 * The generic limiter is a blunt instrument against scraping and accidental
 * request storms. The stricter `loginLimiter` is deliberately *not* the
 * brute-force control - see the note in modules/auth for why the real lockout
 * is counted in the database rather than in this process's memory.
 *
 * **Serverless caveat.** `express-rate-limit` defaults to a MemoryStore, which
 * is per process. On Vercel the effective ceiling is `RATE_LIMIT_MAX` times the
 * number of warm instances, and a cold start resets it. That is acceptable for
 * a blunt instrument, but it is not a quota: do not build billing or abuse
 * policy on it. The login lockout is unaffected because it is counted in the
 * database. If a hard global limit is ever needed, swap the store for a shared
 * one (Redis/Upstash) rather than raising this number.
 */

const jsonError = {
  error: {
    code: CODES.RATE_LIMITED,
    message: "Too many requests. Please slow down and try again shortly.",
  },
};

export const apiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60_000,
  limit: env.rateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: jsonError,
  // Health checks are polled by uptime monitors and should never be throttled.
  skip: (req: Request) => req.path === "/health",
});

export const loginLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: {
      code: CODES.RATE_LIMITED,
      message: "Too many sign-in attempts from this address. Try again in 15 minutes.",
    },
  },
});
