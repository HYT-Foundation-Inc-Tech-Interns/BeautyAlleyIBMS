/**
 * The demo logins, read from the repository-root `demo-accounts.json`.
 *
 * That file is shared with `backend/scripts/demo-accounts.js`, which creates
 * these accounts. Keeping one copy matters: a README that quotes a password
 * the seed does not set is the single most common way a demo breaks, and it is
 * a bug that only shows up in front of an audience.
 */

import raw from "../../demo-accounts.json";
import type { Role } from "@/lib/api-types";

export interface DemoAccount {
  role: Role;
  email: string;
  fullName: string;
  blurb: string;
  employeeId?: string;
  clientId?: string;
}

export const DEMO_PASSWORD: string = raw.password;
export const DEMO_ACCOUNTS: DemoAccount[] = raw.accounts as DemoAccount[];
