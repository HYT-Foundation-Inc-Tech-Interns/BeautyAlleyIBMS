-- ---------------------------------------------------------------------------
-- Door PINs, and the per-device throttle that guards them.
--
-- The kiosk admits a guest by asking the stylist to confirm with a PIN. That
-- means the PIN has to identify *who* typed it, from the PIN alone - the screen
-- knows nobody's employee id, and asking it to choose one would let a stolen
-- device check in guests under any name it liked.
--
-- So the PIN is stored as a blind index rather than as a verifier:
--
--     pin_lookup = HMAC-SHA256(KIOSK_PIN_PEPPER, 'staff-pin:' || pin)
--
-- A plain sha256 would not do. There are only 10,000 four-digit PINs, so an
-- unkeyed digest is a 10,000-row lookup table - a dump of this table would be
-- readable in milliseconds. The pepper is the salt that a per-row value cannot
-- be, because the lookup has to be by value. It lives in the API's environment
-- and never in the database, which is what makes a leaked table useless.
--
-- Two consequences worth stating plainly:
--
--   * `pin_lookup` is UNIQUE. A PIN identifies one person, so two staff cannot
--     share one. With five stylists this is not a constraint anyone will feel;
--     it is also what makes "whose PIN is this" answerable at all.
--   * Changing KIOSK_PIN_PEPPER invalidates every PIN at once. The runbook says
--     so; the alternative is a column that remembers which pepper was used, and
--     that would mean keeping the old one forever.
--
-- A PIN is never returned by any endpoint. There is nothing to return: the
-- table holds a digest, and the plaintext exists only in the staff member's
-- head and in the request that set it.
-- ---------------------------------------------------------------------------

create table if not exists public.staff_pins (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  pin_lookup  text not null unique,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,

  -- HMAC-SHA256 hex. The fixed length catches a caller that passed the PIN
  -- itself instead of the digest, which is the one mistake this design makes
  -- easy.
  constraint staff_pins_lookup_length check (char_length(pin_lookup) = 64)
);

alter table public.staff_pins enable row level security;

revoke all on public.staff_pins from public, anon, authenticated;
grant select, insert, update, delete on public.staff_pins to service_role;

comment on table public.staff_pins is
  'One door PIN per employee, as a peppered HMAC. The PIN itself is never stored.';

-- ---------------------------------------------------------------------------
-- The throttle, kept per device rather than per person.
--
-- A PIN cannot be locked per employee without giving anyone who can reach the
-- tablet a way to lock a stylist out of their own PIN from the lobby. The thing
-- under attack is the screen, so the screen is what backs off: five wrong PINs
-- start a 60-second wait, doubling to a 15-minute ceiling. A correct PIN clears
-- the count, so a stylist who mistypes twice and then gets it right is not
-- penalised for the rest of the shift.
--
-- The columns live here, next to the credential they protect, rather than in a
-- separate table: one row per screen, and a kiosk cannot be deleted while its
-- throttle is in another table's foreign key.
-- ---------------------------------------------------------------------------
alter table public.kiosk_devices
  add column if not exists pin_failures     integer not null default 0,
  add column if not exists pin_locked_until timestamptz;

comment on column public.kiosk_devices.pin_failures is
  'Consecutive wrong door PINs from this screen. Reset to zero by a correct one.';
comment on column public.kiosk_devices.pin_locked_until is
  'No PIN is accepted on this screen before this time. Null when not locked.';

-- ---------------------------------------------------------------------------
-- set_staff_pin()
--
-- Upsert, so "set" and "change" are one operation and the console needs no
-- branch. The unique violation on pin_lookup is translated rather than left to
-- the generic 23505 handler: "That conflicts with an existing record" would
-- send the owner looking through the wrong list.
-- ---------------------------------------------------------------------------
create or replace function public.set_staff_pin(
  p_employee_id uuid,
  p_pin_lookup  text,
  p_actor       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row     public.staff_pins%rowtype;
  v_existed boolean;
begin
  if not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.staff_pins where employee_id = p_employee_id
  ) into v_existed;

  begin
    insert into public.staff_pins (employee_id, pin_lookup, created_by, updated_by)
    values (p_employee_id, p_pin_lookup, p_actor, p_actor)
    on conflict (employee_id) do update
       set pin_lookup = excluded.pin_lookup,
           updated_at = now(),
           updated_by = p_actor
    returning * into v_row;
  exception when unique_violation then
    -- Somebody else already holds this PIN.
    raise exception 'PIN_TAKEN' using errcode = 'P0008';
  end;

  perform public.write_audit(
    p_actor, 'staff.pin_set', 'employees', p_employee_id,
    jsonb_build_object('change', case when v_existed then 'changed' else 'set' end)
  );

  return jsonb_build_object(
    'employeeId', v_row.employee_id,
    'createdAt',  v_row.created_at,
    'updatedAt',  v_row.updated_at
  );
end;
$$;

comment on function public.set_staff_pin(uuid, text, uuid) is
  'Set or replace an employee''s door PIN from its peppered HMAC. Raises PIN_TAKEN when another employee holds it.';

-- ---------------------------------------------------------------------------
-- clear_staff_pin()
--
-- Idempotent on purpose: the owner's intent is "this person has no PIN", and
-- that is already true the second time. No audit row is written for a no-op -
-- an audit trail that records events that did not happen is worse than none.
-- ---------------------------------------------------------------------------
create or replace function public.clear_staff_pin(
  p_employee_id uuid,
  p_actor       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_deleted integer;
begin
  if not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.staff_pins where employee_id = p_employee_id;
  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    perform public.write_audit(
      p_actor, 'staff.pin_cleared', 'employees', p_employee_id
    );
  end if;

  return jsonb_build_object('employeeId', p_employee_id, 'hasPin', false);
end;
$$;

comment on function public.clear_staff_pin(uuid, uuid) is
  'Remove an employee''s door PIN. Idempotent: clearing one that is not set is a success.';

revoke all on function public.set_staff_pin(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.set_staff_pin(uuid, text, uuid) to service_role;

revoke all on function public.clear_staff_pin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.clear_staff_pin(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.set_staff_pin(uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.set_staff_pin(uuid, text, uuid)', 'EXECUTE') then
    raise exception 'set_staff_pin must not be executable by a browser role';
  end if;

  if has_function_privilege('anon', 'public.clear_staff_pin(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.clear_staff_pin(uuid, uuid)', 'EXECUTE') then
    raise exception 'clear_staff_pin must not be executable by a browser role';
  end if;

  if has_table_privilege('anon', 'public.staff_pins', 'SELECT')
     or has_table_privilege('authenticated', 'public.staff_pins', 'SELECT') then
    raise exception 'staff_pins must not be readable by a browser role';
  end if;

  if not has_function_privilege('service_role', 'public.set_staff_pin(uuid, text, uuid)', 'EXECUTE') then
    raise exception 'set_staff_pin must be executable by service_role';
  end if;
end $$;
