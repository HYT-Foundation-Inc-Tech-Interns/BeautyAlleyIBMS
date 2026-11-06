import { z } from "zod";
import { queryBoolean } from "../../lib/query";
import { paginationSchema } from "../../lib/pagination";

export const dashboardQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
});

// These must exist on `v_client_history`. That view exposes derived columns
// (last_visit_at, lifetime_value_cents) rather than the raw clients row, so
// `created_at` is deliberately absent - ordering by it would be a 500 from
// PostgREST rather than a compile error.
export const CLIENT_SORT_COLUMNS = [
  "full_name",
  "last_visit_at",
  "first_visit_at",
  "lifetime_value_cents",
] as const;

export const listClientsQuerySchema = paginationSchema.extend({
  sort: z.enum(CLIENT_SORT_COLUMNS).default("last_visit_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
  q: z.string().trim().max(100).optional(),
  includeInactive: queryBoolean().default(false),
});

export const updateClientSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    email: z.string().trim().toLowerCase().email().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

export const listAuditLogsQuerySchema = paginationSchema.extend({
  action: z.string().trim().max(100).optional(),
  entity: z.string().trim().max(60).optional(),
  entityId: z.guid().optional(),
  actorId: z.guid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const idParamSchema = z.object({ id: z.guid("Not a valid id") });

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

/**
 * The Insights window. Days is how far back the page looks; minDays keeps a
 * client who visited yesterday out of the "did not rebook" list, where they
 * would be noise rather than a signal.
 */
export const insightsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(90),
  minDays: z.coerce.number().int().min(0).max(90).default(14),
});
