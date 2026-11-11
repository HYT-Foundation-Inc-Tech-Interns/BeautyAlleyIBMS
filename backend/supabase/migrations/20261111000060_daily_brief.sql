-- ---------------------------------------------------------------------------
-- The owner's morning brief.
--
-- One email a day at 07:00: what yesterday took, how full the chairs were, who
-- booked again, and the single thing that looks wrong. No new screen - the
-- numbers already exist, and the point of a brief is that nobody has to go and
-- look at them.
--
-- Three pieces:
--
-- 1. `get_daily_brief(date)` - the facts, in one call. It *calls*
--    `get_dashboard_summary` and `get_retention_summary` rather than
--    re-deriving revenue or rebookings, so the brief and the Insights page
--    cannot disagree about the same day. What it adds is the one number the
--    console does not have: chair-hour utilisation.
--
-- 2. `daily_briefs` - one row per day, which is what makes the cron safe. The
--    workflow runs every morning and may be re-run by hand; a brief that has
--    already gone out must not go out again.
--
-- 3. `claim_daily_brief` / `finish_daily_brief` / `release_daily_brief` - the
--    send is claimed before it is attempted and released if it fails. Claiming
--    first is the only ordering that cannot double-send; the stale window is
--    what keeps a crashed run from silencing that morning for ever.
--
-- ## Why the claim expires
--
-- A claim taken and never finished - the runner died between claim and send -
-- would otherwise mean no brief that day, silently. A claim older than 15
-- minutes is therefore takeable again. The window is longer than any plausible
-- SMTP handshake and far shorter than the 24 hours until the next brief.
-- ---------------------------------------------------------------------------

create table if not exists public.daily_briefs (
  brief_date date primary key,
  claimed_at timestamptz not null default now(),
  sent_at    timestamptz,
  recipient  text,
  -- The facts as they stood when the brief went out. Kept so "what did it say
  -- on the 10th" is answerable after a later correction to the booking.
  payload    jsonb
);

comment on table public.daily_briefs is
  'One row per day the owner''s brief was claimed and sent. Also the send lock.';

-- Service role only: this is mail routing and yesterday's takings, not
-- something a browser has any business reading.
alter table public.daily_briefs enable row level security;

-- ---------------------------------------------------------------------------
-- get_daily_brief() - yesterday, in the shape the email needs.
--
-- Utilisation is booked minutes over staffed minutes. Staffed minutes come from
-- `working_hours` for that weekday, less any `time_off` overlapping the day:
-- a stylist on approved leave is not an idle chair. Booked minutes exclude
-- cancelled and no-show bookings - a chair that was never going to be used is
-- not utilisation either.
--
-- A day with nobody on the rota returns staffedMinutes = 0, and the caller
-- reports utilisation as unknown rather than as 0% or 100%.
-- ---------------------------------------------------------------------------

create or replace function public.get_daily_brief(
  p_date     date,
  p_timezone text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tz      text := coalesce(nullif(p_timezone, ''), public.branch_timezone());
  v_start   timestamptz := (p_date::timestamp) at time zone v_tz;
  v_end     timestamptz := ((p_date + 1)::timestamp) at time zone v_tz;
  v_weekday smallint := extract(dow from p_date)::smallint;
  v_dash    jsonb;
  v_ret     jsonb;
  v_booked  int;
  v_staffed int;
  v_trail   jsonb;
begin
  v_dash := public.get_dashboard_summary(p_date, p_date, v_tz);
  v_ret  := public.get_retention_summary(p_date, p_date, 0, v_tz);

  select coalesce(sum(extract(epoch from (b.end_time - b.start_time)) / 60), 0)::int
    into v_booked
    from public.bookings b
   where b.start_time >= v_start
     and b.start_time < v_end
     and b.status not in ('CANCELLED', 'NO_SHOW');

  -- Per employee, because leave is per person: subtracting the day's total
  -- leave from each of a split shift's two windows would count it twice.
  select coalesce(sum(greatest(0, s.shift_minutes - s.leave_minutes)), 0)::int
    into v_staffed
    from (
      select coalesce(sum(extract(epoch from (wh.end_time - wh.start_time)) / 60), 0)::int
               as shift_minutes,
             coalesce((
               select sum(extract(epoch from (
                        least(t.ends_at, v_end) - greatest(t.starts_at, v_start)
                      )) / 60)
                 from public.time_off t
                where t.employee_id = e.id
                  and t.ends_at > v_start
                  and t.starts_at < v_end
             ), 0)::int as leave_minutes
        from public.employees e
        left join public.working_hours wh
          on wh.employee_id = e.id
         and wh.weekday = v_weekday
       where e.is_active
       group by e.id
    ) s;

  -- The same weekday for the previous four weeks. Only weeks that had bookings
  -- are averaged: a closed day would otherwise drag the baseline to zero and
  -- make every open day look like a record.
  select jsonb_build_object(
           'weeks', count(*),
           'avgRevenueCents', coalesce(round(avg(d.revenue_cents))::bigint, 0),
           'avgBookings', coalesce(round(avg(d.bookings)::numeric, 1), 0),
           'avgNoShow', coalesce(round(avg(d.no_show)::numeric, 1), 0),
           'avgCancelled', coalesce(round(avg(d.cancelled)::numeric, 1), 0)
         )
    into v_trail
    from (
      select coalesce(sum(b.total_cents) filter (where b.status = 'COMPLETED'), 0)::bigint
               as revenue_cents,
             count(*)::int as bookings,
             count(*) filter (where b.status = 'NO_SHOW')::int as no_show,
             count(*) filter (where b.status = 'CANCELLED')::int as cancelled
        from public.bookings b
       where (b.start_time at time zone v_tz)::date
             in (p_date - 7, p_date - 14, p_date - 21, p_date - 28)
       group by (b.start_time at time zone v_tz)::date
    ) d;

  return jsonb_build_object(
    'date', p_date,
    'weekday', to_char(p_date, 'FMDay'),
    'totals', v_dash -> 'totals',
    'topService', coalesce(v_dash -> 'topServices' -> 0, 'null'::jsonb),
    'retention', jsonb_build_object(
      'clientsSeen', coalesce((v_ret ->> 'clientsSeen')::int, 0),
      'rebooked', coalesce((v_ret ->> 'rebooked')::int, 0)
    ),
    'utilisation', jsonb_build_object(
      'bookedMinutes', v_booked,
      'staffedMinutes', v_staffed
    ),
    'trailing', v_trail
  );
end $$;

comment on function public.get_daily_brief(date, text) is
  'One day''s takings, utilisation, rebookings and a four-week same-weekday baseline.';

-- ---------------------------------------------------------------------------
-- The send lock.
-- ---------------------------------------------------------------------------

create or replace function public.claim_daily_brief(
  p_date  date,
  p_stale interval default interval '15 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_claimed boolean;
begin
  insert into public.daily_briefs (brief_date)
  values (p_date)
  on conflict (brief_date) do update
     set claimed_at = now()
   where public.daily_briefs.sent_at is null
     and public.daily_briefs.claimed_at < now() - p_stale
  returning true into v_claimed;

  -- No row returned means either "already sent" or "claimed moments ago".
  -- Both mean the caller must not send.
  return coalesce(v_claimed, false);
end $$;

comment on function public.claim_daily_brief(date, interval) is
  'Take the send lock for a day. False when it is already sent or freshly claimed.';

create or replace function public.finish_daily_brief(
  p_date      date,
  p_recipient text,
  p_payload   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.daily_briefs
     set sent_at   = now(),
         recipient = p_recipient,
         payload   = p_payload
   where brief_date = p_date;
end $$;

comment on function public.finish_daily_brief(date, text, jsonb) is
  'Mark the day''s brief as sent, with the facts it carried.';

create or replace function public.release_daily_brief(p_date date)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Only an unsent claim is released. If the mail did go out and the caller
  -- failed afterwards, deleting the row would let the next run send it twice.
  delete from public.daily_briefs
   where brief_date = p_date
     and sent_at is null;
end $$;

comment on function public.release_daily_brief(date) is
  'Drop an unsent claim so the next run can try again.';

-- ---------------------------------------------------------------------------
-- Privileges: the brief is sent by a script holding the service role, never by
-- a browser.
-- ---------------------------------------------------------------------------

revoke all on table public.daily_briefs from public, anon, authenticated;
grant all on table public.daily_briefs to service_role;

revoke all on function public.get_daily_brief(date, text) from public, anon, authenticated;
revoke all on function public.claim_daily_brief(date, interval) from public, anon, authenticated;
revoke all on function public.finish_daily_brief(date, text, jsonb) from public, anon, authenticated;
revoke all on function public.release_daily_brief(date) from public, anon, authenticated;

grant execute on function public.get_daily_brief(date, text) to service_role;
grant execute on function public.claim_daily_brief(date, interval) to service_role;
grant execute on function public.finish_daily_brief(date, text, jsonb) to service_role;
grant execute on function public.release_daily_brief(date) to service_role;

-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.get_daily_brief(date, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_daily_brief(date, text)', 'EXECUTE') then
    raise exception 'get_daily_brief must not be executable by a browser role';
  end if;

  if has_function_privilege('anon', 'public.claim_daily_brief(date, interval)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finish_daily_brief(date, text, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.release_daily_brief(date)', 'EXECUTE') then
    raise exception 'the brief send lock must not be executable by anon';
  end if;

  if not has_function_privilege('service_role', 'public.get_daily_brief(date, text)', 'EXECUTE') then
    raise exception 'get_daily_brief must be executable by service_role';
  end if;

  if not has_function_privilege('service_role', 'public.claim_daily_brief(date, interval)', 'EXECUTE') then
    raise exception 'claim_daily_brief must be executable by service_role';
  end if;
end $$;
