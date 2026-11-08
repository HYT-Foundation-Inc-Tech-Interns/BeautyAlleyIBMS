-- ---------------------------------------------------------------------------
-- The door kiosk: a device credential the owner can issue and revoke.
--
-- The kiosk is a screen by the entrance that is not a staff account. It cannot
-- hold an email and password that nobody types, and it must not be able to do
-- anything except look up an arrival pass and ask for a staff PIN. So it gets
-- its own credential: a random secret, issued once, stored only as a hash.
--
-- Two different jobs, deliberately separated:
--   * the hash  proves the device is the one we issued (a stolen table row is
--     not a usable token);
--   * the row   is what makes revocation immediate. A signature cannot be
--     un-signed, which is why this is a table lookup on every request rather
--     than a self-contained token.
--
-- RLS is on with no policies at all: a browser has no business reading a
-- device table, and denial is expressed by the absence of a policy rather than
-- by a predicate someone can later "tidy".
-- ---------------------------------------------------------------------------

create table if not exists public.kiosk_devices (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,
  token_hash   text not null unique,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  last_seen_ip inet,
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles (id) on delete set null,

  constraint kiosk_devices_label_length
    check (char_length(btrim(label)) between 1 and 60),
  -- sha256 hex. Not a password hash: the secret is 256 bits of CSPRNG, so the
  -- only property needed is one-wayness, and a fixed length is a cheap way to
  -- catch a caller that stored the token instead of its digest.
  constraint kiosk_devices_token_hash_length
    check (char_length(token_hash) = 64)
);

alter table public.kiosk_devices enable row level security;

revoke all on public.kiosk_devices from public, anon, authenticated;
grant select, insert, update, delete on public.kiosk_devices to service_role;

-- ---------------------------------------------------------------------------
-- create_kiosk_device()
--
-- The token is generated in Node and only its hash arrives here, so this
-- function cannot leak a credential even in an error message. Returns the row
-- as the API shows it - never the hash.
-- ---------------------------------------------------------------------------
create or replace function public.create_kiosk_device(
  p_label      text,
  p_token_hash text,
  p_actor      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.kiosk_devices%rowtype;
begin
  insert into public.kiosk_devices (label, token_hash, created_by)
  values (btrim(p_label), p_token_hash, p_actor)
  returning * into v_row;

  perform public.write_audit(
    p_actor, 'kiosk.created', 'kiosk_devices', v_row.id,
    jsonb_build_object('label', v_row.label)
  );

  return jsonb_build_object(
    'id', v_row.id,
    'label', v_row.label,
    'createdAt', v_row.created_at,
    'lastSeenAt', v_row.last_seen_at,
    'revokedAt', v_row.revoked_at
  );
end;
$$;

comment on function public.create_kiosk_device(text, text, uuid) is
  'Register a kiosk device from the sha256 of its secret. The secret itself never reaches the database.';

-- ---------------------------------------------------------------------------
-- revoke_kiosk_device()
--
-- Revocation is a timestamp, not a delete: "which device admitted this guest"
-- has to stay answerable after the device is gone. Re-revoking is refused
-- rather than treated as success, so a double click is visible instead of
-- silently rewriting when the device was actually disabled.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_kiosk_device(
  p_id    uuid,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.kiosk_devices%rowtype;
begin
  select * into v_row from public.kiosk_devices where id = p_id for update;

  if not found then
    raise exception 'KIOSK_NOT_FOUND' using errcode = 'P0006';
  end if;

  if v_row.revoked_at is not null then
    raise exception 'KIOSK_ALREADY_REVOKED' using errcode = 'P0007';
  end if;

  update public.kiosk_devices
     set revoked_at = now(),
         revoked_by = p_actor
   where id = p_id
  returning * into v_row;

  perform public.write_audit(
    p_actor, 'kiosk.revoked', 'kiosk_devices', p_id,
    jsonb_build_object('label', v_row.label)
  );

  return jsonb_build_object(
    'id', v_row.id,
    'label', v_row.label,
    'createdAt', v_row.created_at,
    'lastSeenAt', v_row.last_seen_at,
    'revokedAt', v_row.revoked_at
  );
end;
$$;

comment on function public.revoke_kiosk_device(uuid, uuid) is
  'Disable a kiosk device. The row is kept so past admissions stay attributable.';

revoke all on function public.create_kiosk_device(text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_kiosk_device(text, text, uuid) to service_role;

revoke all on function public.revoke_kiosk_device(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_kiosk_device(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.create_kiosk_device(text, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_kiosk_device(text, text, uuid)', 'EXECUTE') then
    raise exception 'create_kiosk_device must not be executable by a browser role';
  end if;

  if has_function_privilege('anon', 'public.revoke_kiosk_device(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.revoke_kiosk_device(uuid, uuid)', 'EXECUTE') then
    raise exception 'revoke_kiosk_device must not be executable by a browser role';
  end if;

  if not has_function_privilege('service_role', 'public.create_kiosk_device(text, text, uuid)', 'EXECUTE') then
    raise exception 'create_kiosk_device must be executable by service_role';
  end if;
end $$;
