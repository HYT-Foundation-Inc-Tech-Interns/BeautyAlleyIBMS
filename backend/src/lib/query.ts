import { z } from "zod";

/**
 * A boolean that arrives as a query string.
 *
 * `z.coerce.boolean()` is a trap here: it runs `Boolean(value)`, and
 * `Boolean("false")` is `true`. So `?activeOnly=false` — a client asking for
 * *everything* — silently returned only the active rows. That is how a pending
 * promo proposal disappeared from the approval queue: the list sent
 * `activeOnly=false` and the server read it as "active only".
 *
 * Only the exact strings count. An empty value is treated as absent, so
 * `?flag=` falls through to the default rather than failing validation.
 */
export function queryBoolean() {
  return z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((value) => value === true || value === "true"),
  );
}
