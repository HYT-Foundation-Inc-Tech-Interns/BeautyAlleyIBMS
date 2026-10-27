-- ---------------------------------------------------------------------------
-- Migration 41: the massage and body menu.
--
-- Source: the business's printed price list. It supplies five treatments and
-- their prices; the names and descriptions below are its wording, verbatim.
-- Two values the price list does not carry had to be chosen anyway, and they
-- are flagged here rather than quietly presented as fact:
--
--   * DURATIONS. `services.duration_minutes` is NOT NULL and the price list
--     gives no times, so every row carries a PLACEHOLDER picked from how long
--     that treatment realistically holds a room. Unlike the wellness rows in
--     migration 22 these are NOT written into the description: the copy here
--     is the business's own and has to reach the site as written. Correct them
--     in Admin -> Services.
--
--   * ROOMS. `required_room_type` is NULL for all five. The floor has no
--     MASSAGE rooms seeded - migration 22 created three IV lounges and a VIP
--     room - and a required type with no matching room makes every slot
--     unbookable, because availability finds nothing to hold. The four salon
--     rows already behave this way. Set the type once the rooms exist.
--
-- Category is SPA: these are the treatment-room services, the same category
-- the original Signature Massage carries. They sit in their own subcategory so
-- the public menu can ask for this list by name instead of "the cheapest five
-- things in the catalogue", which is what it used to do and why it showed
-- vitamin add-ons on the front page.
--
-- `loyalty_eligible` stays false: migration 20 turns loyalty on for SALON only
-- and the Admin can flip individual rows later.
--
-- Idempotent: matched on name, so re-running inserts nothing.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The subcategory.
-- ---------------------------------------------------------------------------
insert into public.service_subcategories (category, name, slug, sort_order)
values ('SPA', 'Massage & Body', 'massage-body', 10)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The five treatments.
--
-- Prices are in centavos, exactly as the price list prints them:
--   Combination Massage            P 800    ->   80 000
--   Hot Stone w/ Combination       P 1 500  ->  150 000
--   Therapeutic Massage            P 950    ->   95 000
--   Body Scrub                     P 500    ->   50 000
--   Body Scrub w/ Massage          P 1 200  ->  120 000
-- ---------------------------------------------------------------------------
insert into public.services (
  id, name, category, subcategory_id, description,
  price_cents, duration_minutes, required_room_type, loyalty_eligible, is_active
)
select
  v.id::uuid, v.name, 'SPA'::public.service_category, sc.id, v.description,
  v.price_cents, v.duration_minutes, null, false, true
from (values
  ('11111111-0000-0000-0000-000000000021', 'Combination Massage',
   'These services are designed to promote overall wellness and reduce stress, tension and muscle pain.',
   80000, 60),

  ('11111111-0000-0000-0000-000000000022', 'Hot Stone w/ Combination Massage',
   'Massage that uses smooth, heated stones to deeply penetrate the muscles and release tension.',
   150000, 90),

  ('11111111-0000-0000-0000-000000000023', 'Therapeutic Massage',
   'Gentle massage that uses essential oils to promote relaxation and balance in the body and mind.',
   95000, 60),

  ('11111111-0000-0000-0000-000000000024', 'Body Scrub',
   'A rejuvenating treatment that gently exfoliates the skin to remove dead skin cells, leaving the body feeling smooth, soft, and refreshed.',
   50000, 60),

  ('11111111-0000-0000-0000-000000000025', 'Body Scrub w/ Massage',
   'A refreshing treatment that combines gentle body exfoliation and relaxing massage to leave the skin smooth, the body relaxed, and the senses revitalized.',
   120000, 90)
) as v (id, name, description, price_cents, duration_minutes)
cross join public.service_subcategories sc
where sc.slug = 'massage-body'
  and not exists (
    select 1 from public.services s where s.name = v.name
  );

-- ---------------------------------------------------------------------------
-- 3. Someone has to be able to deliver them, or the menu is a lie.
--
-- Ana is the senior therapist and takes all five. Bea is the skin and nail
-- specialist, so she takes the two body scrubs and not the massages. Cara
-- stays hair-only - the qualification tests rely on that gap.
-- ---------------------------------------------------------------------------
insert into public.employee_services (employee_id, service_id)
select e.id, s.id
from public.employees e
cross join public.services s
join public.service_subcategories sc on sc.id = s.subcategory_id
where sc.slug = 'massage-body'
  and e.is_active
  and (
    e.full_name = 'Ana Reyes'
    or (e.full_name = 'Bea Santos' and s.name like 'Body Scrub%')
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Self-checks.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
  v_bad   integer;
  v_names text;
begin
  select count(*) into v_count
    from public.services s
    join public.service_subcategories sc on sc.id = s.subcategory_id
   where sc.slug = 'massage-body';
  if v_count <> 5 then
    raise exception 'migration 41: expected 5 massage/body services, found %', v_count;
  end if;

  -- The five prices are the business's own. Anything else means a typo.
  select count(*) into v_bad
    from public.services s
    join public.service_subcategories sc on sc.id = s.subcategory_id
   where sc.slug = 'massage-body'
     and s.price_cents not in (80000, 95000, 120000, 150000, 50000);
  if v_bad > 0 then
    raise exception 'migration 41: % massage/body service(s) carry an unexpected price', v_bad;
  end if;

  -- Priced, active, and in the right category.
  select count(*) into v_bad
    from public.services s
    join public.service_subcategories sc on sc.id = s.subcategory_id
   where sc.slug = 'massage-body'
     and (not s.is_active or s.price_cents <= 0 or s.category <> 'SPA');
  if v_bad > 0 then
    raise exception 'migration 41: % massage/body service(s) are inactive, unpriced or mis-categorised', v_bad;
  end if;

  -- Each needs at least one qualified stylist. Skipped on a database with no
  -- employees yet: there is nobody to qualify and failing there would be the
  -- wrong reason.
  if exists (select 1 from public.employees where is_active) then
    select string_agg(s.name, ', ') into v_names
      from public.services s
      join public.service_subcategories sc on sc.id = s.subcategory_id
     where sc.slug = 'massage-body'
       and not exists (
         select 1 from public.employee_services es where es.service_id = s.id
       );
    if v_names is not null then
      raise exception 'migration 41: massage/body service(s) with no qualified stylist: %', v_names;
    end if;
  else
    raise notice 'migration 41: no active employees - skipping the qualification check';
  end if;
end $$;
