/**
 * Error vocabulary.
 *
 * The database functions in migration 10 signal failures with
 * `raise exception 'CODE' using errcode = '<class>'`. This module is the one
 * place that translates those into HTTP. Keeping the mapping in a single table
 * means a new error code cannot be added to SQL without a matching status
 * here - and anything unmapped falls back to 500 rather than leaking a raw
 * Postgres message to the client.
 */

export const CODES = {
  // --- 400 bad request -----------------------------------------------------
  VALIDATION_FAILED: "VALIDATION_FAILED",
  SERVICES_REQUIRED: "SERVICES_REQUIRED",
  SERVICES_INVALID: "SERVICES_INVALID",
  START_TIME_REQUIRED: "START_TIME_REQUIRED",
  START_TIME_IN_PAST: "START_TIME_IN_PAST",
  CLIENT_REQUIRED: "CLIENT_REQUIRED",
  OUTSIDE_WORKING_HOURS: "OUTSIDE_WORKING_HOURS",
  CANCELLATION_WINDOW_PASSED: "CANCELLATION_WINDOW_PASSED",
  QR_INVALID: "QR_INVALID",
  QR_EXPIRED: "QR_EXPIRED",
  QR_TOO_EARLY: "QR_TOO_EARLY",
  QR_TOO_LATE: "QR_TOO_LATE",

  // --- 401 / 403 -----------------------------------------------------------
  UNAUTHENTICATED: "UNAUTHENTICATED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  FORBIDDEN: "FORBIDDEN",
  EMPLOYEE_NOT_QUALIFIED: "EMPLOYEE_NOT_QUALIFIED",
  INSUFFICIENT_ROLE: "INSUFFICIENT_ROLE",

  // --- 404 -----------------------------------------------------------------
  NOT_FOUND: "NOT_FOUND",
  BOOKING_NOT_FOUND: "BOOKING_NOT_FOUND",
  EMPLOYEE_NOT_FOUND: "EMPLOYEE_NOT_FOUND",
  SERVICE_NOT_FOUND: "SERVICE_NOT_FOUND",
  CLIENT_NOT_FOUND: "CLIENT_NOT_FOUND",

  // --- 409 conflict --------------------------------------------------------
  SLOT_TAKEN: "SLOT_TAKEN",
  ALREADY_CHECKED_IN: "ALREADY_CHECKED_IN",
  ALREADY_CANCELLED: "ALREADY_CANCELLED",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  CONFLICT: "CONFLICT",

  // --- 429 -----------------------------------------------------------------
  RATE_LIMITED: "RATE_LIMITED",

  // --- 503 -----------------------------------------------------------------
  CONFIG_ERROR: "CONFIG_ERROR",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",

  // --- 500 -----------------------------------------------------------------
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof CODES)[keyof typeof CODES];

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  /** Safe to serialise to the client. */
  readonly details?: unknown;
  /** Internal only - logged, never sent. */
  override readonly cause?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    cause?: string
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.cause = cause;
    Error.captureStackTrace?.(this, AppError);
  }

  // `code` is typed as `string` rather than `ErrorCode` on purpose: the
  // mapping tables in this file are the source of truth, and a caller passing
  // a code that is not in them should be a runtime 500, not a compile error
  // that pushes people to cast.
  static badRequest(code: string, message: string, details?: unknown) {
    return new AppError(400, code, message, details);
  }
  static unauthorized(code: string = CODES.UNAUTHENTICATED, message = "Authentication required") {
    return new AppError(401, code, message);
  }
  static forbidden(code: string = CODES.FORBIDDEN, message = "Not permitted") {
    return new AppError(403, code, message);
  }
  static notFound(code: string = CODES.NOT_FOUND, message = "Not found") {
    return new AppError(404, code, message);
  }
  static conflict(code: string, message: string, details?: unknown) {
    return new AppError(409, code, message, details);
  }
  static config(message: string) {
    return new AppError(503, CODES.CONFIG_ERROR, message);
  }
  static internal(message = "Something went wrong") {
    return new AppError(500, CODES.INTERNAL, message);
  }
}

/**
 * Error codes raised by the PL/pgSQL functions, mapped to HTTP status.
 * Keep in step with the `raise exception` calls in 10_functions.sql.
 */
const PG_FUNCTION_ERRORS: Record<string, { status: number; code: string }> = {
  SLOT_TAKEN: { status: 409, code: CODES.SLOT_TAKEN },
  SERVICES_REQUIRED: { status: 400, code: CODES.SERVICES_REQUIRED },
  SERVICES_INVALID: { status: 400, code: CODES.SERVICES_INVALID },
  START_TIME_REQUIRED: { status: 400, code: CODES.START_TIME_REQUIRED },
  START_TIME_IN_PAST: { status: 400, code: CODES.START_TIME_IN_PAST },
  CLIENT_REQUIRED: { status: 400, code: CODES.CLIENT_REQUIRED },
  OUTSIDE_WORKING_HOURS: { status: 400, code: CODES.OUTSIDE_WORKING_HOURS },
  CANCELLATION_WINDOW_PASSED: { status: 400, code: CODES.CANCELLATION_WINDOW_PASSED },
  EMPLOYEE_NOT_QUALIFIED: { status: 403, code: CODES.EMPLOYEE_NOT_QUALIFIED },
  EMPLOYEE_NOT_FOUND: { status: 404, code: CODES.EMPLOYEE_NOT_FOUND },
  NO_EMPLOYEE_AVAILABLE: { status: 409, code: CODES.SLOT_TAKEN },
  BOOKING_NOT_FOUND: { status: 404, code: CODES.BOOKING_NOT_FOUND },
  ALREADY_CANCELLED: { status: 409, code: CODES.ALREADY_CANCELLED },
  ALREADY_CHECKED_IN: { status: 409, code: CODES.ALREADY_CHECKED_IN },
  INVALID_STATUS_TRANSITION: { status: 409, code: CODES.INVALID_STATUS_TRANSITION },
  QR_INVALID: { status: 400, code: CODES.QR_INVALID },
  QR_EXPIRED: { status: 400, code: CODES.QR_EXPIRED },
  QR_REVOKED: { status: 400, code: CODES.QR_INVALID },
  QR_TOO_EARLY: { status: 400, code: CODES.QR_TOO_EARLY },
  QR_TOO_LATE: { status: 400, code: CODES.QR_TOO_LATE },
};

/** SQLSTATE classes we care about. */
const PG_SQLSTATE: Record<string, { status: number; code: string }> = {
  "23P01": { status: 409, code: CODES.SLOT_TAKEN }, // exclusion_violation
  "23505": { status: 409, code: CODES.CONFLICT }, // unique_violation
  "23503": { status: 400, code: CODES.VALIDATION_FAILED }, // foreign_key_violation
  "23514": { status: 400, code: CODES.VALIDATION_FAILED }, // check_violation
  "22P02": { status: 400, code: CODES.VALIDATION_FAILED }, // invalid_text_representation
  "42501": { status: 403, code: CODES.FORBIDDEN }, // insufficient_privilege
  PGRST116: { status: 404, code: CODES.NOT_FOUND }, // PostgREST: no rows
};

/** PROMO_* codes all carry the same status. */
function promoError(message: string): { status: number; code: string } | null {
  return message.startsWith("PROMO_")
    ? { status: 400, code: message }
    : null;
}

/**
 * The error code our own functions raise, read off the front of the message.
 *
 * Migrations raise either `'CODE'` or `'CODE: detail'` - the status-transition
 * trigger raises `INVALID_STATUS_TRANSITION: COMPLETED -> PENDING`, for
 * instance, so that the log says which transition was attempted. Matching the
 * whole message would miss those and report a 500, so the code is taken as the
 * text before the first colon.
 *
 * Anything else - Postgres's own messages, which can contain colons - is not in
 * the table and falls through to the 500 path, which is the safe direction: an
 * unrecognised message is never echoed to the client.
 */
function functionErrorCode(message: string): string | null {
  const head = message.trim().split(":", 1)[0].trim().toUpperCase();
  if (PG_FUNCTION_ERRORS[head] || head.startsWith("PROMO_")) return head;
  return null;
}

/**
 * Normalise anything thrown by supabase-js / pg into an AppError.
 *
 * Raw Postgres messages are never forwarded to the client: they can name
 * tables, columns and constraints, and occasionally echo row data. The
 * original is attached as `details.cause` for the logs only.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  const anyErr = err as {
    message?: string;
    code?: string;
    details?: string;
    status?: number;
    statusCode?: number;
    type?: string;
  } | null;
  const message = typeof anyErr?.message === "string" ? anyErr.message : "";
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";

  // 0. Errors raised by Express's own middleware.
  //
  // express.json() throws a SyntaxError carrying `status: 400` and
  // `type: 'entity.parse.failed'` when the body is not valid JSON. Without this
  // branch it falls through to the 500 fallback, and a client typo is reported
  // as a server fault - which then shows up in error dashboards as an outage.
  //
  // The discriminator is `type`, NOT `status`. supabase-js's AuthApiError also
  // carries `status: 400` (bad password, weak password, duplicate signup), and
  // matching on status alone reported a wrong password as VALIDATION_FAILED/400
  // instead of INVALID_CREDENTIALS/401 - the message checks further down never
  // ran. Only body-parser errors use the `entity.*` namespace.
  const bodyParserType = typeof anyErr?.type === "string" ? anyErr.type : "";
  if (bodyParserType === "entity.parse.failed") {
    return new AppError(400, CODES.VALIDATION_FAILED, "The request body is not valid JSON");
  }
  if (bodyParserType === "entity.too.large") {
    return new AppError(413, CODES.VALIDATION_FAILED, "The request body is too large");
  }
  if (bodyParserType.startsWith("entity.") || bodyParserType === "charset.unsupported") {
    const status = anyErr?.status ?? anyErr?.statusCode;
    return new AppError(
      typeof status === "number" && status >= 400 && status < 500 ? status : 400,
      CODES.VALIDATION_FAILED,
      "The request could not be processed"
    );
  }

  // 1. SQLSTATE - checked first, it is the most reliable signal.
  const byState = code ? PG_SQLSTATE[code] : undefined;
  if (byState) {
    // A unique violation on the booking reference is worth naming precisely.
    if (code === "23505" && /reference/i.test(anyErr?.details || message)) {
      return new AppError(409, CODES.CONFLICT, "Booking reference collision, please retry", undefined, message);
    }
    return new AppError(byState.status, byState.code, humanise(byState.code), undefined, message);
  }

  // 2. Raised by our own functions, which put the code at the front of the
  // message.
  const fnCode = functionErrorCode(message);
  if (fnCode) {
    const byFn = PG_FUNCTION_ERRORS[fnCode];
    if (byFn) {
      return new AppError(byFn.status, byFn.code, humanise(byFn.code), undefined, message);
    }

    const byPromo = promoError(fnCode);
    if (byPromo) {
      return new AppError(byPromo.status, byPromo.code, humanise(byPromo.code));
    }
  }

  // 3. Supabase Auth. `AuthApiError.code` is the stable machine-readable
  // signal; the message is a fallback for older GoTrue versions that omit it.
  const AUTH_CODES: Record<string, { status: number; code: string; message: string }> = {
    invalid_credentials: {
      status: 401,
      code: CODES.INVALID_CREDENTIALS,
      message: "Email or password is incorrect",
    },
    email_not_confirmed: {
      status: 403,
      code: CODES.FORBIDDEN,
      message: "Email address has not been confirmed",
    },
    user_already_exists: {
      status: 409,
      code: CODES.CONFLICT,
      message: "An account with that email already exists",
    },
    email_exists: {
      status: 409,
      code: CODES.CONFLICT,
      message: "An account with that email already exists",
    },
    weak_password: {
      status: 400,
      code: CODES.VALIDATION_FAILED,
      message: "That password is too weak",
    },
    over_email_send_rate_limit: {
      status: 429,
      code: CODES.RATE_LIMITED,
      message: "Too many emails sent. Please wait before trying again.",
    },
    over_request_rate_limit: {
      status: 429,
      code: CODES.RATE_LIMITED,
      message: "Too many requests. Please slow down.",
    },
    same_password: {
      status: 400,
      code: CODES.VALIDATION_FAILED,
      message: "The new password must differ from the current one",
    },
    user_banned: {
      status: 403,
      code: CODES.ACCOUNT_DISABLED,
      message: "This account has been disabled",
    },
  };

  const byAuthCode = code ? AUTH_CODES[code] : undefined;
  if (byAuthCode) {
    return new AppError(byAuthCode.status, byAuthCode.code, byAuthCode.message);
  }

  if (/invalid login credentials/i.test(message)) {
    return AppError.unauthorized(CODES.INVALID_CREDENTIALS, "Email or password is incorrect");
  }
  if (/email not confirmed/i.test(message)) {
    return AppError.forbidden(CODES.FORBIDDEN, "Email address has not been confirmed");
  }
  if (/user already registered|already been registered/i.test(message)) {
    return AppError.conflict(CODES.CONFLICT, "An account with that email already exists");
  }

  // Nothing matched. The client gets a generic 500 - but the original message
  // is carried on `cause` so the log has something to work with. Dropping it
  // here would mean every unmapped failure is undiagnosable.
  return new AppError(500, CODES.INTERNAL, "Something went wrong", undefined, message || undefined);
}

const MESSAGES: Record<string, string> = {
  [CODES.SLOT_TAKEN]: "That time slot has just been taken. Please pick another.",
  [CODES.SERVICES_REQUIRED]: "At least one service is required.",
  [CODES.SERVICES_INVALID]: "One or more services are unknown or inactive.",
  [CODES.START_TIME_REQUIRED]: "A start time is required.",
  [CODES.START_TIME_IN_PAST]: "The start time must be in the future.",
  [CODES.CLIENT_REQUIRED]: "Provide either a client id or a guest phone number.",
  [CODES.OUTSIDE_WORKING_HOURS]: "That time is outside the stylist's working hours.",
  [CODES.CANCELLATION_WINDOW_PASSED]:
    "This booking can no longer be cancelled online. Please call the salon.",
  [CODES.EMPLOYEE_NOT_QUALIFIED]: "That stylist does not deliver the selected service.",
  [CODES.EMPLOYEE_NOT_FOUND]: "No such employee.",
  [CODES.BOOKING_NOT_FOUND]: "No such booking.",
  [CODES.ALREADY_CANCELLED]: "This booking is already cancelled.",
  [CODES.ALREADY_CHECKED_IN]: "This booking has already been checked in.",
  [CODES.INVALID_STATUS_TRANSITION]: "That status change is not allowed.",
  [CODES.QR_INVALID]: "That check-in code is not valid.",
  [CODES.QR_EXPIRED]: "That check-in code has expired.",
  [CODES.QR_TOO_EARLY]: "This pass is not active yet.",
  [CODES.QR_TOO_LATE]: "This appointment has already ended.",
  [CODES.CONFLICT]: "That conflicts with an existing record.",
  [CODES.VALIDATION_FAILED]: "The request contained invalid data.",
  [CODES.FORBIDDEN]: "You do not have access to that.",
};

function humanise(code: string): string {
  if (MESSAGES[code]) return MESSAGES[code];
  if (code.startsWith("PROMO_")) {
    const reason = code.slice("PROMO_".length);
    const reasons: Record<string, string> = {
      NOT_FOUND: "That promo code does not exist.",
      INACTIVE: "That promo code is no longer active.",
      NOT_STARTED: "That promo code is not active yet.",
      EXPIRED: "That promo code has expired.",
      MIN_SPEND_NOT_MET: "The booking total is below the minimum for that code.",
      NOT_APPLICABLE: "That promo code does not apply to the selected services.",
      LIMIT_REACHED: "That promo code has reached its redemption limit.",
    };
    return reasons[reason] || "That promo code cannot be applied.";
  }
  return "Something went wrong.";
}
