-- ---------------------------------------------------------------------------
-- Leave becomes a request that is decided, not a fact that is written.
--
-- Until now a row in time_off was simply true: the owner typed it, it took
-- effect, and the booking engine avoided it. That is fine for a five-person
-- salon and wrong for a rota, because the stylist has no way to ask and the
-- owner has no way to say no without deleting the record of having asked.
--
-- status is the whole model. PENDING is a request nobody has answered;
-- APPROVED and DECLINED are answers, and both carry who gave it and when.
-- Existing rows are backfilled as APPROVED with their own created_at as the
-- decision stamp - they were already in force, and pretending otherwise would
-- put the roster in a state the owner never chose.
-- ---------------------------------------------------------------------------

alter table public.time_off
  add column if not exists status        text not null default 'APPROVED',
  add column if not exists requested_by  uuid references auth.users (id) on delete set null,
  add column if not exists decided_by    uuid references auth.users (id) on delete set null,
  add column if not exists decided_at    timestamptz,
  add column if not exists decision_note text;

update public.time_off
   set decided_at = created_at
 where decided_at is null
   and status <> 'PENDING';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'time_off_status_check') then
    alter table public.time_off
      add constraint time_off_status_check
      check (status in ('PENDING', 'APPROVED', 'DECLINED'));
  end if;

  -- A pending request has no decision, and a decided one always has a stamp.
  -- Without this the two can drift and the panel shows "approved" with nobody
  -- behind it.
  if not exists (select 1 from pg_constraint where conname = 'time_off_decision_stamp') then
    alter table public.time_off
      add constraint time_off_decision_stamp
      check ((status = 'PENDING') = (decided_at is null));
  end if;
end $$;

create index if not exists time_off_status_idx
  on public.time_off (status, starts_at);

create index if not exists time_off_range_idx
  on public.time_off using gist (tstzrange(starts_at, ends_at));

-- ---------------------------------------------------------------------------
-- get_leave_board - the owner's rota view for a window.
--
-- One row per day, because the question is always "can we cover Thursday",
-- never "how many days did Ana take this quarter". For each day:
--
--   scheduled  active stylists whose weekly pattern includes that weekday
--   off        of those, how many have approved leave that day
--   available  scheduled - off, floored at zero
--   pending    requests nobody has answered yet that touch the day
--
-- The people array carries the names, because a count of two does not tell the
-- owner whether the two are the two who can do balayage.
--
-- Days are branch-local dates and leave is instants, so the overlap test is
-- done against the local day's boundaries, not against midnight UTC.
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
     and t.starts_at < (select ((p_to + 1)::timestamp) at time zone tz from p)
     and t.ends_at   > (select (p_from::timestamp) at time zone tz from p)
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
                    'status', l.status
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
             'status', l.status
           ) order by l.starts_at)
      from leave l
     where l.status = 'PENDING'
  ), '[]'::jsonb)
);
$$;

revoke all on function public.get_leave_board(date, date, text) from public, anon, authenticated;
grant execute on function public.get_leave_board(date, date, text) to service_role;
