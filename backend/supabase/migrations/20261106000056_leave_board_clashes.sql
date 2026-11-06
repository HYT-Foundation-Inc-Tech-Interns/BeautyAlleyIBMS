-- ---------------------------------------------------------------------------
-- get_leave_board, third pass: it now says what an approval would break.
--
-- The owner's real question before saying yes is not "how many days is this"
-- but "who is already booked into them". Each request therefore carries a
-- clash count against its own range, and the board carries the appointments
-- themselves - the ones sitting inside *approved* leave, which are the ones
-- somebody has to move or call.
--
-- Cancelled and no-show rows are not clashes: they are already out of the
-- diary. CHECKED_IN and IN_SERVICE are included on purpose - a guest standing
-- at the desk is the most expensive thing to discover later.
-- ---------------------------------------------------------------------------

create or replace function public.get_leave_board(
  p_from     date,
  p_to       date,
  p_timezone text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
with p as (
  select coalesce(nullif(p_timezone, ''), public.branch_timezone()) as tz
),
bounds as (
  select (p_from::timestamp) at time zone p.tz          as starts_at,
         ((p_to + 1)::timestamp) at time zone p.tz      as ends_at
    from p
),
days as (
  select g::date                                   as day,
         (g::timestamp) at time zone p.tz          as starts_at,
         ((g + interval '1 day')::timestamp) at time zone p.tz as ends_at
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
   cross join p
),
leave as (
  select t.id, t.employee_id, e.full_name, t.starts_at, t.ends_at, t.reason, t.status
    from public.time_off t
    join public.employees e on e.id = t.employee_id
   where t.status in ('PENDING', 'APPROVED')
     and t.starts_at < (select ends_at from bounds)
     and t.ends_at   > (select starts_at from bounds)
),
scheduled as (
  select d.day, count(distinct e.id)::int as n
    from days d
    join public.working_hours wh on wh.weekday = extract(dow from d.day)::int
    join public.employees e on e.id = wh.employee_id and e.is_active
   group by d.day
),
per_day as (
  select d.day,
         count(distinct l.employee_id)
           filter (where l.status = 'APPROVED')::int as approved_off,
         count(distinct l.employee_id)
           filter (where l.status = 'PENDING')::int  as pending_off,
         count(distinct l.employee_id)
           filter (where l.status = 'APPROVED'
                     and exists (select 1 from public.working_hours wh
                                  where wh.employee_id = l.employee_id
                                    and wh.weekday = extract(dow from d.day)::int))::int as uncovered,
         coalesce(jsonb_agg(jsonb_build_object(
                    'id', l.id,
                    'employeeId', l.employee_id,
                    'fullName', l.full_name,
                    'startsAt', l.starts_at,
                    'endsAt', l.ends_at,
                    'reason', l.reason,
                    'status', l.status,
                    'clashes', (
                      select count(*)::int
                        from public.bookings b
                       where b.employee_id = l.employee_id
                         and b.status in ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE')
                         and b.start_time < l.ends_at
                         and b.end_time   > l.starts_at
                    )
                  ) order by l.starts_at)
                  filter (where l.id is not null), '[]'::jsonb) as people
    from days d
    left join leave l on l.starts_at < d.ends_at and l.ends_at > d.starts_at
   group by d.day
)
select jsonb_build_object(
  'from', p_from,
  'to', p_to,
  'timezone', (select tz from p),
  'days', coalesce((
    select jsonb_agg(jsonb_build_object(
             'date', pd.day,
             'scheduled', coalesce(s.n, 0),
             'approvedOff', pd.approved_off,
             'pendingOff', pd.pending_off,
             'available', greatest(coalesce(s.n, 0) - pd.uncovered, 0),
             'people', pd.people
           ) order by pd.day)
      from per_day pd
      left join scheduled s on s.day = pd.day
  ), '[]'::jsonb),
  'pending', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id,
             'employeeId', l.employee_id,
             'fullName', l.full_name,
             'startsAt', l.starts_at,
             'endsAt', l.ends_at,
             'reason', l.reason,
             'status', l.status,
             'clashes', (
               select count(*)::int
                 from public.bookings b
                where b.employee_id = l.employee_id
                  and b.status in ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE')
                  and b.start_time < l.ends_at
                  and b.end_time   > l.starts_at
             )
           ) order by l.starts_at)
      from leave l
     where l.status = 'PENDING'
  ), '[]'::jsonb),
  'affected', coalesce((
    select jsonb_agg(jsonb_build_object(
             'bookingId', a.id,
             'reference', a.reference,
             'employeeId', a.employee_id,
             'employeeName', a.employee_name,
             'clientName', a.client_name,
             'startsAt', a.start_time,
             'endsAt', a.end_time,
             'status', a.status
           ) order by a.start_time)
      from (
        select b.id, b.reference, b.employee_id, e.full_name as employee_name,
               coalesce(c.full_name, b.guest_name) as client_name,
               b.start_time, b.end_time, b.status
          from public.bookings b
          join public.employees e on e.id = b.employee_id
          left join public.clients c on c.id = b.client_id
         where b.status in ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE')
           and b.start_time < (select ends_at from bounds)
           and b.end_time   > (select starts_at from bounds)
           and exists (
             select 1 from public.time_off t
              where t.employee_id = b.employee_id
                and t.status = 'APPROVED'
                and t.starts_at < b.end_time
                and t.ends_at   > b.start_time
           )
         order by b.start_time
         limit 50
      ) a
  ), '[]'::jsonb)
);
$$;

revoke all on function public.get_leave_board(date, date, text) from public, anon, authenticated;
grant execute on function public.get_leave_board(date, date, text) to service_role;
