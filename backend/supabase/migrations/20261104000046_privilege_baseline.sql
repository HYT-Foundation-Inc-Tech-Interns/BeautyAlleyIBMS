-- ---------------------------------------------------------------------------
-- Privilege baseline.
--
-- A fresh Supabase project grants `anon` and `authenticated` ALL PRIVILEGES on
-- every table in `public` by default, and relies on RLS to filter rows. This
-- project does not: production was hardened by hand to grant SELECT on a short
-- list of tables and column-scoped UPDATE on exactly two, with no table-level
-- INSERT/UPDATE/DELETE at all.
--
-- The integration suite asserts that posture:
--
--   * `anon` must not have SELECT on bookings
--   * `authenticated` must not have UPDATE on profiles.role or profiles.is_active
--   * a client promoting themselves to ADMIN must fail with 42501
--
-- On a fresh database those assertions failed, because the default grants were
-- still in place. This migration reproduces production's matrix so a new
-- environment behaves like the real one.
--
-- It is safe to run on production: the REVOKE removes privileges that are not
-- there, and the GRANTs restate the ones that are. It does not touch
-- `service_role`, which is how the API reads and writes.
--
-- Adding a new public table? Grant explicitly here or in its own migration.
-- The default is now "no access", which is the right default.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Public catalogue: readable without signing in. RLS still filters inactive
-- rows and the API still decides what a guest may see.
grant select on public.services              to anon, authenticated;
grant select on public.service_subcategories to anon, authenticated;
grant select on public.employees             to anon, authenticated;
grant select on public.employee_services     to anon, authenticated;
grant select on public.rooms                 to anon, authenticated;

-- Signed-in reads. `authenticate` reads the caller's own profile, client and
-- employee rows with the caller's token, so these must be readable by
-- `authenticated`; RLS narrows each one to the caller.
grant select on public.profiles       to authenticated;
grant select on public.clients        to authenticated;
grant select on public.bookings       to authenticated;
grant select on public.booking_items  to authenticated;
grant select on public.booking_notes  to authenticated;

-- The only columns a signed-in user may write directly. Everything else is
-- written by the API with the service role, or by a SECURITY DEFINER function.
-- A table-level UPDATE here would re-open the self-promotion hole.
grant update (full_name, phone)        on public.profiles to authenticated;
grant update (full_name, phone, email) on public.clients  to authenticated;
