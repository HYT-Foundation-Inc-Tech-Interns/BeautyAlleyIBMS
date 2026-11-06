-- ---------------------------------------------------------------------------
-- app_settings grants
--
-- Migration 44 created the table and enabled RLS, but the creating role's
-- default privileges did not include `service_role`. RLS bypass is not the
-- same as a table GRANT: the API's service-role client could see the table in
-- the schema and still receive `42501 insufficient_privilege` on every read,
-- which the error mapper turns into a generic 403.
--
-- The symptom was precise and easy to misread: `/auth/me` worked (it reads
-- `profiles`, which has the grant), while `/settings/payments` answered 403
-- for a verified ADMIN. The role was fine; the table privilege was missing.
--
-- `anon` and `authenticated` deliberately get nothing. RLS is enabled with no
-- policies, so even with a grant they would see zero rows; withholding the
-- grant makes that explicit and fails closed.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.app_settings to service_role;
