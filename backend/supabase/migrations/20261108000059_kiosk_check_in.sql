-- ---------------------------------------------------------------------------
-- The door admits a guest.
--
-- Three pieces, and they exist because the tablet is not a person.
--
-- 1. `checkins.kiosk_id` - which screen let this guest in. The staff member is
--    already on the row (`staff_id`); this is the other half of "who was
--    responsible", and the half that survives a stylist leaving. `set null`
--    rather than `cascade`: losing the attribution must never delete the
--    record that somebody was admitted.
--
-- 2. `check_in_booking(..., p_kiosk_id)` - one redemption path, not two. The
--    desk and the door must not have separate code for admitting a guest, or
--    the deposit guard, the token redemption and the audit entry drift apart.
--
-- 3. `verify_staff_pin()` and `kiosk_arrival()` - the two reads the door needs,
--    each returning exactly what a screen in a public lobby should be told and
--    nothing more.
--
-- ## Why verify_staff_pin RETURNS a verdict instead of raising
--
-- This is the subtlest thing in this file. The throttle has to be *recorded*
-- when a PIN is wrong, and in PL/pgSQL an exception rolls back the whole
-- statement - including the UPDATE that just incremented the counter. A
-- function that raised `KIOSK_PIN_INVALID` would therefore count every failure
-- and remember none of them: the lockout would never fire, silently.
--
-- So the function commits the counter and returns `{ ok: false, reason }`, and
-- the service turns that into an HTTP status. The error codes in this file are
-- still raised for the cases with nothing to commit - an unknown or revoked
-- device.
-- ---------------------------------------------------------------------------

alter table public.checkins
  add column if not exists kiosk_id uuid
    references public.kiosk_devices (id) on delete set null;

comment on column public.checkins.kiosk_id is
  'The door screen that admitted this guest, when the admission came from one. Null for a desk check-in.';

create index if not exists checkins_kiosk_idx
  on public.checkins (kiosk_id)
  where kiosk_id is not null;

-- ---------------------------------------------------------------------------
-- check_in_booking(), now told which device did it
--
-- Dropped first: a new defaulted parameter would leave two overloads that
-- PostgREST cannot tell apart, which is the same trap migration 41 documents.
-- ---------------------------------------------------------------------------
drop function if exists public.check_in_booking(uuid, uuid, uuid, integer, boolean);

create or replace function public.check_in_booking(
  p_jti            uuid,
  p_staff_id       uuid default null,
  p_actor          uuid default null,
  p_window_minutes integer default 60,
  p_force          boolean default false,
  p_kiosk_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token      public.qr_tokens%rowtype;
  v_booking    public.bookings%rowtype;
  v_now        timestamptz := now();
  v_early      boolean;
  v_checkin_id uuid;
begin
  select * into v_token from public.qr_tokens where jti = p_jti for update;

  if not found then
    raise exception 'QR_INVALID' using errcode = 'P0008';
  end if;

  if v_token.revoked_at is not null then
    raise exception 'QR_REVOKED' using errcode = 'P0010';
  end if;

  if v_token.expires_at <= v_now then
    raise exception 'QR_EXPIRED' using errcode = 'P0009';
  end if;

  select * into v_booking from public.bookings where id = v_token.booking_id for update;

  if v_booking.status = 'CHECKED_IN' then
    raise exception 'ALREADY_CHECKED_IN' using errcode = 'P0007';
  end if;

  if v_booking.status in ('CANCELLED', 'COMPLETED', 'NO_SHOW') then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0007';
  end if;

  v_early := v_now < v_booking.start_time
             - make_interval(mins => greatest(coalesce(p_window_minutes, 0), 0));

  if v_early and not coalesce(p_force, false) then
    raise exception 'QR_TOO_EARLY' using errcode = 'P0011';
  end if;

  if v_now > v_booking.end_time then
    raise exception 'QR_TOO_LATE' using errcode = 'P0011';
  end if;

  insert into public.checkins (booking_id, staff_id, kiosk_id)
  values (v_booking.id, p_staff_id, p_kiosk_id)
  returning id into v_checkin_id;

  update public.qr_tokens set used_at = v_now where id = v_token.id;

  update public.bookings
     set status = 'CHECKED_IN', updated_at = v_now
   where id = v_booking.id;

  perform public.write_audit(
    p_actor, 'booking.checked_in', 'bookings', v_booking.id,
    jsonb_build_object(
      'staffId',    p_staff_id,
      'kioskId',    p_kiosk_id,
      'jti',        p_jti,
      'early',      v_early,
      'overridden', v_early and coalesce(p_force, false)
    )
  );

  return jsonb_build_object(
    'bookingId',   v_booking.id,
    'reference',   v_booking.reference,
    'status',      'CHECKED_IN',
    'checkedInAt', v_now,
    'checkinId',   v_checkin_id,
    'early',       v_early
  );
end;
$$;

comment on function public.check_in_booking(uuid, uuid, uuid, integer, boolean, uuid) is
  'Redeems a pass. p_force skips the early-arrival window only; p_kiosk_id records the door screen that admitted the guest.';

revoke all on function public.check_in_booking(uuid, uuid, uuid, integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.check_in_booking(uuid, uuid, uuid, integer, boolean, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- verify_staff_pin()
--
-- Looks a PIN up by its blind index and, on a miss, records the attempt against
-- the *device*. Five misses start a 60-second wait that doubles to a 15-minute
-- ceiling; a hit clears the count. Locking the person instead would let anyone
-- in the lobby lock a stylist out of their own PIN.
--
-- `for update` on the device row serialises two people pressing the tablet at
-- the same time, so the counter cannot lose an increment.
--
-- A correct PIN for a deactivated stylist is reported as INACTIVE, not INVALID:
-- they would otherwise keep retyping a PIN that is, in fact, right.
-- ---------------------------------------------------------------------------
create or replace function public.verify_staff_pin(
  p_kiosk_id   uuid,
  p_pin_lookup text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_dev   public.kiosk_devices%rowtype;
  v_emp   public.employees%rowtype;
  v_fails integer;
  v_wait  integer;
begin
  select * into v_dev from public.kiosk_devices where id = p_kiosk_id for update;

  if not found then
    raise exception 'KIOSK_NOT_FOUND' using errcode = 'P0006';
  end if;

  if v_dev.revoked_at is not null then
    raise exception 'KIOSK_REVOKED' using errcode = 'P0013';
  end if;

  if v_dev.pin_locked_until is not null and v_dev.pin_locked_until > now() then
    return jsonb_build_object(
      'ok', false,
      'reason', 'LOCKED',
      'retryAfterSeconds', greatest(
        1,
        ceil(extract(epoch from (v_dev.pin_locked_until - now())))::int
      )
    );
  end if;

  select e.* into v_emp
    from public.staff_pins p
    join public.employees e on e.id = p.employee_id
   where p.pin_lookup = p_pin_lookup;

  if not found then
    v_fails := v_dev.pin_failures + 1;
    v_wait  := case
                 when v_fails >= 5 then least(60 * (2 ^ (v_fails - 5)), 900)::int
                 else 0
               end;

    update public.kiosk_devices
       set pin_failures     = v_fails,
           pin_locked_until = case when v_wait > 0
                                   then now() + make_interval(secs => v_wait)
                                   else null
                              end
     where id = p_kiosk_id;

    return jsonb_build_object(
      'ok', false,
      'reason', 'INVALID',
      'attemptsLeft', greatest(0, 5 - v_fails)
    );
  end if;

  if v_emp.is_active is not true then
    return jsonb_build_object(
      'ok', false,
      'reason', 'INACTIVE',
      'employeeId', v_emp.id
    );
  end if;

  update public.kiosk_devices
     set pin_failures = 0,
         pin_locked_until = null
   where id = p_kiosk_id;

  return jsonb_build_object(
    'ok', true,
    'employeeId', v_emp.id,
    'fullName', v_emp.full_name
  );
end;
$$;

comment on function public.verify_staff_pin(uuid, text) is
  'Check a door PIN and throttle the device. Returns a verdict rather than raising, so a wrong PIN is still counted.';

revoke all on function public.verify_staff_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_staff_pin(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- kiosk_arrival()
--
-- What the door screen is allowed to know about one pass: the guest's name, who
-- they are seeing, what they booked, when, and whether anything blocks the
-- admission. Deliberately no phone number, no client id, no money and no notes -
-- this shape is read in a public lobby and must stay that narrow.
--
-- The service names come from `name_snapshot`, not from `services`: the guest
-- booked that name, and a renamed or retired treatment should not rewrite the
-- screen's description of what they are having.
-- ---------------------------------------------------------------------------
create or replace function public.kiosk_arrival(p_jti uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token    public.qr_tokens%rowtype;
  v_booking  public.bookings%rowtype;
  v_name     text;
  v_staff    text;
  v_services text[];
begin
  select * into v_token from public.qr_tokens where jti = p_jti;

  if not found then
    raise exception 'QR_INVALID' using errcode = 'P0008';
  end if;

  select * into v_booking from public.bookings where id = v_token.booking_id;

  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(b.guest_name, c.full_name)
    into v_name
    from public.bookings b
    left join public.clients c on c.id = b.client_id
   where b.id = v_booking.id;

  select full_name into v_staff from public.employees where id = v_booking.employee_id;

  select array_agg(bi.name_snapshot order by bi.name_snapshot)
    into v_services
    from public.booking_items bi
   where bi.booking_id = v_booking.id;

  return jsonb_build_object(
    'reference',     v_booking.reference,
    'status',        v_booking.status,
    'startTime',     v_booking.start_time,
    'endTime',       v_booking.end_time,
    'guestName',     v_name,
    'staffName',     v_staff,
    'services',      coalesce(to_jsonb(v_services), '[]'::jsonb),
    'passUsed',      v_token.used_at is not null,
    'passRevoked',   v_token.revoked_at is not null,
    'passExpiresAt', v_token.expires_at,
    'depositDue',    exists (
      select 1 from public.booking_deposits d
       where d.booking_id = v_booking.id and d.status = 'DUE'
    )
  );
end;
$$;

comment on function public.kiosk_arrival(uuid) is
  'The arrival summary a door screen may see: who, what, when, and what blocks admission. No contact details, no money.';

revoke all on function public.kiosk_arrival(uuid) from public, anon, authenticated;
grant execute on function public.kiosk_arrival(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.verify_staff_pin(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.verify_staff_pin(uuid, text)', 'EXECUTE') then
    raise exception 'verify_staff_pin must not be executable by a browser role';
  end if;

  if has_function_privilege('anon', 'public.kiosk_arrival(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.kiosk_arrival(uuid)', 'EXECUTE') then
    raise exception 'kiosk_arrival must not be executable by a browser role';
  end if;

  if has_function_privilege(
       'anon',
       'public.check_in_booking(uuid, uuid, uuid, integer, boolean, uuid)',
       'EXECUTE'
     ) then
    raise exception 'check_in_booking must not be executable by anon';
  end if;

  if not has_function_privilege(
           'service_role',
           'public.check_in_booking(uuid, uuid, uuid, integer, boolean, uuid)',
           'EXECUTE'
         ) then
    raise exception 'check_in_booking must be executable by service_role';
  end if;

  -- The old five-argument overload must be gone, or PostgREST will refuse the
  -- call as ambiguous the first time the desk checks somebody in.
  if exists (
    select 1 from pg_proc
     where proname = 'check_in_booking'
       and pronamespace = 'public'::regnamespace
       and pronargs = 5
  ) then
    raise exception 'the five-argument check_in_booking still exists';
  end if;
end $$;
