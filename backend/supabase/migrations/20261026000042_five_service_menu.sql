-- ---------------------------------------------------------------------------
-- Migration 42: the menu is five treatments, and nothing else.
--
-- The business sells five massage and body treatments (migration 41). The four
-- demo salon rows and the ten wellness rows that the catalogue used to carry
-- are RETIRED here.
--
-- ## Retired by name, never by exclusion
--
-- The retirement below is an explicit list of the fourteen rows that existed
-- before this menu. It deliberately does NOT say "everything that is not one
-- of the five": a service the Admin creates tomorrow is also "not one of the
-- five", so that wording would retire it silently on the next run. This file
-- is safe to re-run, and safe to paste into the SQL editor.
--
-- The name is the key. A future service must not reuse one of the fourteen
-- legacy names, or it will be treated as legacy.
--
-- ## Retired, not deleted
--
-- `booking_items.service_id` is `on delete set null`. Deleting a service would
-- therefore succeed and silently blank out what every past booking was for -
-- the history would survive as rows that no longer say what was delivered.
-- Deactivating keeps the history readable and hides the row from every public
-- surface, because `services_public_read` (migration 9) only ever returns
-- active rows. It is also exactly what `DELETE /api/v1/services/:id` does.
--
-- The console still shows the retired rows, behind its "inactive" filter, so
-- the Admin can bring one back or confirm it is gone. A hard delete is
-- available to the Admin per row if the history really is disposable.
--
-- ## Qualifications for the retired rows are left alone
--
-- They are inert: availability and booking both look at active services only.
-- Deleting them would mean that reactivating a service later also silently
-- made it unbookable, which is a worse surprise than an unused join row.
--
-- ## What this file does not do
--
-- It does not reactivate the five, and it does not assert a total count. Both
-- would undo a legitimate Admin decision on a re-run: retiring one of the five
-- is the Admin's call, and a sixth service is the Admin's call too.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The legacy catalogue is retired by name.
--
--    `and is_active` makes this a no-op on a second run: zero rows updated.
-- ---------------------------------------------------------------------------
update public.services
   set is_active = false
 where is_active
   and name in (
     -- the four demo salon rows
     'Cut & Style',
     'Radiance Facial',
     'Signature Massage',
     'Manicure & Pedicure',
     -- the ten wellness rows
     'Korean Glass Skin Drip',
     'Korean Youthful Glowing Skin Drip',
     'Luminous Drip',
     'Immune Booster Drip',
     'Anti-Aging Shot (Placenta)',
     'Rejuvenating Shot (Collagen)',
     'Placenta Add-on',
     'Collagen Add-on',
     'Vitamin C Add-on',
     'Multivitamins Add-on (Vitamin B12)'
   );

-- ---------------------------------------------------------------------------
-- 2. Cara is the therapeutic specialist, so she takes the two treatments that
--    are hers. Migration 41 gave Ana the whole menu and Bea the scrubs; the
--    only additions are here.
--
--    The gaps this leaves are the ones the integration tests depend on:
--      Therapeutic Massage  -> Cara alone   (auto-assignment is forced)
--      Body Scrub           -> Ana and Bea  (the desk can move a booking)
--      Combination Massage  -> Ana alone    (Cara is refused)
--
--    Additive: `on conflict do nothing`, so a re-run inserts nothing. It does
--    restore this one qualification if the Admin removed it, which is the
--    intended demo state and not a service retirement.
-- ---------------------------------------------------------------------------
insert into public.employee_services (employee_id, service_id)
select e.id, s.id
from public.employees e
cross join public.services s
where e.is_active
  and e.full_name = 'Cara Lim'
  and s.name in ('Therapeutic Massage', 'Hot Stone w/ Combination Massage')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Self-checks.
--
--    Only one hard assertion: the five must exist. That is stable under Admin
--    choices - retiring a service flips is_active, it does not delete the row.
--
--    Everything else is a NOTICE. An exception here would abort the whole
--    file - including the retirement above - over a condition the Admin fixes
--    in the console, and would block every later migration.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
  v_names   text;
begin
  select string_agg(v.name, ', ') into v_missing
  from (values
    ('Combination Massage'),
    ('Hot Stone w/ Combination Massage'),
    ('Therapeutic Massage'),
    ('Body Scrub'),
    ('Body Scrub w/ Massage')
  ) as v (name)
  where not exists (
    select 1 from public.services s where s.name = v.name
  );

  if v_missing is not null then
    raise exception 'migration 42: expected service(s) missing - run migration 41 first: %',
      v_missing;
  end if;

  select string_agg(name, ', ' order by name) into v_names
    from public.services
   where name in (
     'Combination Massage',
     'Hot Stone w/ Combination Massage',
     'Therapeutic Massage',
     'Body Scrub',
     'Body Scrub w/ Massage'
   )
     and not is_active;

  if v_names is not null then
    raise notice 'migration 42: service(s) currently inactive: %', v_names;
  end if;

  select string_agg(s.name, ', ') into v_names
    from public.services s
   where s.is_active
     and s.name in (
       'Combination Massage',
       'Hot Stone w/ Combination Massage',
       'Therapeutic Massage',
       'Body Scrub',
       'Body Scrub w/ Massage'
     )
     and not exists (
       select 1 from public.employee_services es
        join public.employees e on e.id = es.employee_id and e.is_active
       where es.service_id = s.id
     );

  if v_names is not null then
    raise notice 'migration 42: active service(s) with no qualified stylist: %', v_names;
  end if;
end $$;
