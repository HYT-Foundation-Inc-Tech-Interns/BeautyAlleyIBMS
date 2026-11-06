-- ---------------------------------------------------------------------------
-- Baseline: the four legacy demo services.
--
-- Migration 23 expects four demo rows (Signature Massage, Cut & Style,
-- Radiance Facial, Manicure & Pedicure) to exist so it can deactivate them and
-- clear their invented prices. Those rows were created by hand in the original
-- database and were never part of any migration, so a fresh database failed
-- migration 23 with:
--
--     expected 4 flagged demo services, found 0
--
-- This was found by running the migration chain against the new test project.
-- Production already has the rows, so this migration must be a no-op there.
--
-- The guard is the `needs_pricing` column: migration 23 adds it. If it already
-- exists, this database is past 23 and the rows were handled there. If it does
-- not exist, this is a fresh install and the rows are needed for 23 to find.
--
-- The prices and durations below are deliberately obvious placeholders. They
-- are zeroed by migration 23 in the same run; nothing here is ever offered.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'services'
       and column_name = 'needs_pricing'
  ) then
    insert into public.services (name, category, description, price_cents, duration_minutes, is_active)
    select v.name,
           v.category::public.service_category,
           'Legacy demo row. Deactivated and cleared by migration 23.',
           100,
           60,
           true
      from (values
        ('Signature Massage',   'SPA'),
        ('Cut & Style',         'SALON'),
        ('Radiance Facial',     'SALON'),
        ('Manicure & Pedicure', 'SALON')
      ) as v(name, category)
     where not exists (
       select 1 from public.services s where s.name = v.name
     );
  end if;
end $$;
