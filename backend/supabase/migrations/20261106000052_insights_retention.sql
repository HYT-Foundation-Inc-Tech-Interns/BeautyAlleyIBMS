-- ---------------------------------------------------------------------------
-- Retention and promo performance.
--
-- Two read-only questions the owner already asks, answered from data that is
-- already there:
--   1. Of the clients who visited in the period, who has not booked again?
--   2. Which promo codes brought revenue, and what did the discount cost?
--
-- Both are security definer and service-role only. A browser never calls them
-- directly; the API maps the result.
-- ---------------------------------------------------------------------------

create or replace function public.get_retention_summary(
  p_from     date,
  p_to       date,
  p_min_days integer default 14,
  p_timezone text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tz    text := coalesce(nullif(p_timezone, ''), public.branch_timezone());
  v_start timestamptz := (p_from::timestamp) at time zone v_tz;
  v_end   timestamptz := ((p_to + 1)::timestamp) at time zone v_tz;
  v_today date := (now() at time zone v_tz)::date;
  v_min   integer := greatest(coalesce(p_min_days, 14), 0);
begin
  return (
    with visited as (
      select b.client_id,
             max(b.start_time)                          as last_visit,
             count(*)::int                              as visits,
             coalesce(sum(b.total_cents), 0)::bigint    as value_cents
        from public.bookings b
       where b.status = 'COMPLETED'
         and b.client_id is not null
         and b.start_time >= v_start
         and b.start_time < v_end
       group by b.client_id
    ),
    later as (
      select distinct b.client_id
        from public.bookings b
        join visited v on v.client_id = b.client_id
       where b.start_time > v.last_visit
         and b.status in ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'COMPLETED')
    ),
    lost as (
      select v.client_id,
             v.last_visit,
             v.visits,
             v.value_cents,
             c.full_name,
             c.phone,
             c.email,
             (v_today - (v.last_visit at time zone v_tz)::date) as days_since
        from visited v
        join public.clients c on c.id = v.client_id
       where not exists (select 1 from later l where l.client_id = v.client_id)
         and (v_today - (v.last_visit at time zone v_tz)::date) >= v_min
    )
    select jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'minDays', v_min,
      'clientsSeen', (select count(*) from visited),
      'rebooked', (
        select count(*) from visited v
         where exists (select 1 from later l where l.client_id = v.client_id)
      ),
      'didNotRebook', (select count(*) from lost),
      'clients', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'clientId', client_id,
                 'fullName', full_name,
                 'phone', phone,
                 'email', email,
                 'lastVisit', last_visit,
                 'daysSince', days_since,
                 'visits', visits,
                 'valueCents', value_cents
               ) order by days_since desc, value_cents desc)
          from (
            select * from lost
             order by days_since desc, value_cents desc
             limit 20
          ) x
      ), '[]'::jsonb)
    )
  );
end $$;

comment on function public.get_retention_summary(date, date, integer, text) is
  'Clients who completed a visit in the period and have not booked again, with the rebook rate.';

create or replace function public.get_promo_performance(
  p_from     date,
  p_to       date,
  p_timezone text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tz    text := coalesce(nullif(p_timezone, ''), public.branch_timezone());
  v_start timestamptz := (p_from::timestamp) at time zone v_tz;
  v_end   timestamptz := ((p_to + 1)::timestamp) at time zone v_tz;
begin
  return (
    with perf as (
      select pc.code,
             count(*) filter (where pr.released_at is null)::int                 as redemptions,
             coalesce(sum(pr.amount_cents) filter (where pr.released_at is null), 0)::bigint as discount_cents,
             count(*) filter (where b.status = 'COMPLETED')::int                as completed,
             coalesce(sum(b.total_cents) filter (where b.status = 'COMPLETED'), 0)::bigint as revenue_cents,
             count(*) filter (where b.status = 'NO_SHOW')::int                  as no_shows
        from public.promo_redemptions pr
        join public.promo_codes pc on pc.id = pr.promo_code_id
        join public.bookings b on b.id = pr.booking_id
       where b.start_time >= v_start
         and b.start_time < v_end
       group by pc.code
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', code,
             'redemptions', redemptions,
             'discountCents', discount_cents,
             'completed', completed,
             'revenueCents', revenue_cents,
             'noShows', no_shows
           ) order by revenue_cents desc, redemptions desc), '[]'::jsonb)
      from (
        select * from perf
         order by revenue_cents desc, redemptions desc
         limit 10
      ) x
  );
end $$;

comment on function public.get_promo_performance(date, date, text) is
  'Redemptions, discount cost, completed revenue and no-shows per promo code.';

revoke all on function public.get_retention_summary(date, date, integer, text) from public, anon, authenticated;
revoke all on function public.get_promo_performance(date, date, text) from public, anon, authenticated;
grant execute on function public.get_retention_summary(date, date, integer, text) to service_role;
grant execute on function public.get_promo_performance(date, date, text) to service_role;
