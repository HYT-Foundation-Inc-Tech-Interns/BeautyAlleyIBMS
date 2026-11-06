-- ---------------------------------------------------------------------------
-- Retention cohort, second pass.
--
-- The first version divided "rebooked" by every client seen, while the lost
-- list only counted clients at least minDays past their visit. A client who
-- visited last week was therefore in the denominator but could not yet be in
-- either outcome, so "5 of 10 did not book again" and "20% rebooked" could
-- both be true and still leave three people unexplained.
--
-- The rate is now over the eligible cohort: clients whose last visit is at
-- least minDays ago. clientsSeen stays as the wider count, and tooRecent is
-- the difference, so the tile can say why the numbers do not add up to it.
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
    eligible as (
      select v.client_id,
             v.last_visit,
             v.visits,
             v.value_cents,
             (v_today - (v.last_visit at time zone v_tz)::date) as days_since
        from visited v
       where (v_today - (v.last_visit at time zone v_tz)::date) >= v_min
    ),
    later as (
      select distinct b.client_id
        from public.bookings b
        join eligible e on e.client_id = b.client_id
       where b.start_time > e.last_visit
         and b.status in ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'COMPLETED')
    ),
    lost as (
      select e.client_id,
             e.last_visit,
             e.visits,
             e.value_cents,
             e.days_since,
             c.full_name,
             c.phone,
             c.email
        from eligible e
        join public.clients c on c.id = e.client_id
       where not exists (select 1 from later l where l.client_id = e.client_id)
    )
    select jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'minDays', v_min,
      'clientsSeen', (select count(*) from visited),
      'eligible', (select count(*) from eligible),
      'tooRecent', (select count(*) from visited) - (select count(*) from eligible),
      'rebooked', (
        select count(*) from eligible e
         where exists (select 1 from later l where l.client_id = e.client_id)
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

revoke all on function public.get_retention_summary(date, date, integer, text) from public, anon, authenticated;
grant execute on function public.get_retention_summary(date, date, integer, text) to service_role;
