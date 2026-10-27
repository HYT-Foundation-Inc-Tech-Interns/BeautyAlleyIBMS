-- ===========================================================================
-- 41. check_in_booking(): an audited early-arrival override
--
-- The door scanner has always refused a pass outside its window. That is the
-- right default: a guest who turns up two hours early has not arrived in any
-- sense the record can use, and admitting them silently would make the
-- check-in time a fiction.
--
-- The desk does sometimes need to admit them anyway - a guest who came
-- straight from the airport, a quiet afternoon with a free chair. That used to
-- be done by writing the status directly, which skipped the checkins row, the
-- token redemption and this window altogether: the exception existed but left
-- no trace of who made it.
--
-- So the override moves into the one path that does all three. `p_force`
-- skips the early check only, and the audit entry carries `early` (the pass was
-- outside its window) and `overridden` (that window was actually skipped) -
-- which is the difference between "the desk pressed a button that had a force
-- flag on it" and "somebody was admitted before they were due".
--
-- Late arrivals are deliberately NOT overridable. A guest arriving after the
-- appointment has ended is a no-show, which is a different decision with its
-- own button and its own record.
--
-- The parameter is added, so the old signature is dropped first: two overloads
-- differing only by a defaulted argument make the PostgREST call ambiguous.
-- ===========================================================================

drop function if exists public.check_in_booking(uuid, uuid, uuid, integer);

create or replace function public.check_in_booking(
  p_jti            uuid,
  p_staff_id       uuid default null,
  p_actor          uuid default null,
  p_window_minutes integer default 60,
  p_force          boolean default false
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

  -- Whether this arrival is ahead of the window, decided once so the guard and
  -- the audit entry cannot disagree about it.
  v_early := v_now < v_booking.start_time
             - make_interval(mins => greatest(coalesce(p_window_minutes, 0), 0));

  if v_early and not coalesce(p_force, false) then
    raise exception 'QR_TOO_EARLY' using errcode = 'P0011';
  end if;

  if v_now > v_booking.end_time then
    raise exception 'QR_TOO_LATE' using errcode = 'P0011';
  end if;

  insert into public.checkins (booking_id, staff_id)
  values (v_booking.id, p_staff_id)
  returning id into v_checkin_id;

  update public.qr_tokens set used_at = v_now where id = v_token.id;

  update public.bookings
     set status = 'CHECKED_IN', updated_at = v_now
   where id = v_booking.id;

  perform public.write_audit(
    p_actor, 'booking.checked_in', 'bookings', v_booking.id,
    jsonb_build_object(
      'staffId',    p_staff_id,
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

comment on function public.check_in_booking(uuid, uuid, uuid, integer, boolean) is
  'Redeems a pass. p_force skips the early-arrival window only, and the audit row records that it did.';

-- Service-role only, like the other write functions. Migration 13 already sets
-- these defaults for new functions; repeating them here keeps the file honest
-- on a database where that default was changed by hand.
revoke all on function public.check_in_booking(uuid, uuid, uuid, integer, boolean) from public;
revoke all on function public.check_in_booking(uuid, uuid, uuid, integer, boolean) from anon, authenticated;
grant execute on function public.check_in_booking(uuid, uuid, uuid, integer, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege(
       'anon',
       'public.check_in_booking(uuid, uuid, uuid, integer, boolean)',
       'EXECUTE'
     ) then
    raise exception 'check_in_booking must not be executable by anon';
  end if;

  if not has_function_privilege(
           'service_role',
           'public.check_in_booking(uuid, uuid, uuid, integer, boolean)',
           'EXECUTE'
         ) then
    raise exception 'check_in_booking must be executable by service_role';
  end if;
end $$;
