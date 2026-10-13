import path from "path";
import dotenv from "dotenv";
import { z } from "zod";

// Resolved from the compiled location (dist/config) or the source location
// (src/config) - both sit two levels below the project root.
//
// .env.local holds the real credentials and is gitignored; it is read first so
// it wins. .env is tracked and carries placeholders only, so a fresh clone can
// still start and will fail loudly on the missing values rather than silently
// running against someone else's project.
dotenv.config({
  path: [
    path.join(__dirname, "..", "..", ".env.local"),
    path.join(__dirname, "..", "..", ".env"),
  ],
});

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  SUPABASE_URL: z.string().url("SUPABASE_URL must be a full https URL"),

  // Supabase now issues `sb_publishable_...` / `sb_secret_...` keys in place of
  // the legacy `anon` / `service_role` JWTs. Both formats are accepted here -
  // the SDK handles either - so this only checks that something was supplied.
  SUPABASE_ANON_KEY: z.string().min(20, "SUPABASE_ANON_KEY looks too short"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional().or(z.literal("")),

  // Only used by scripts/migrate.js and scripts/verify.js.
  DATABASE_URL: z.string().optional(),

  BRANCH_TIMEZONE: z.string().default("Asia/Manila"),
  CANCELLATION_WINDOW_HOURS: z.coerce.number().int().nonnegative().default(2),

  QR_SIGNING_SECRET: z
    .string()
    .min(32, "QR_SIGNING_SECRET must be at least 32 chars"),
  QR_CHECKIN_WINDOW_MINUTES: z.coerce.number().int().nonnegative().default(60),

  // Where a scanned QR pass points. Defaults to the branch check-in page.
  QR_CHECKIN_URL: z.string().url().default("https://beautyalley.app/check-in"),

  // The walk-in door QR. A different sticker from the desk check-in QR: this
  // one starts a registration, the other redeems an existing pass.
  BRANCH_ID: z.string().trim().min(1).default("beautyalley-main"),
  QR_ENTER_URL: z.string().url().default("https://beautyalley.app/welcome"),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map(
    (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`
  );
  // Fail loudly at boot rather than throwing a confusing undefined deep inside
  // a request handler later on.
  throw new Error(
    `Invalid environment configuration:\n${lines.join("\n")}\n\n` +
      `Copy .env.example to .env and fill it in.`
  );
}

export const env = {
  nodeEnv: parsed.data.NODE_ENV,
  isProduction: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
  port: parsed.data.PORT,

  supabaseUrl: parsed.data.SUPABASE_URL,
  supabaseAnonKey: parsed.data.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY || "",

  databaseUrl: parsed.data.DATABASE_URL || "",

  branchTimezone: parsed.data.BRANCH_TIMEZONE,
  cancellationWindowHours: parsed.data.CANCELLATION_WINDOW_HOURS,

  qrSigningSecret: parsed.data.QR_SIGNING_SECRET,
  qrCheckinWindowMinutes: parsed.data.QR_CHECKIN_WINDOW_MINUTES,
  qrCheckInUrl: parsed.data.QR_CHECKIN_URL,
  branchId: parsed.data.BRANCH_ID,
  qrEnterUrl: parsed.data.QR_ENTER_URL,

  loginMaxAttempts: parsed.data.LOGIN_MAX_ATTEMPTS,
  loginLockoutMinutes: parsed.data.LOGIN_LOCKOUT_MINUTES,
};

export const hasServiceRoleKey = env.supabaseServiceRoleKey.length > 0;
