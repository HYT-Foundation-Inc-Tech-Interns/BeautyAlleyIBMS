-- ---------------------------------------------------------------------------
-- app_settings
--
-- A small key/value store for configuration the owner can change without a
-- deploy. The first key is the payment provider list, because the salon wants
-- every provider available as an option and none of them wired to a processor
-- yet.
--
-- Why a table and not an env var: a provider toggle is business configuration,
-- not deployment configuration. Changing it should not require a redeploy, and
-- it should be visible to the next person who signs in as ADMIN.
--
-- Why JSONB: the shape of a setting is owned by the feature that reads it. A
-- column per setting would turn every new toggle into a migration; a single
-- opaque blob would lose the ability to constrain anything. A key/value row
-- with a JSONB value is the middle: new keys need no DDL, and each key's shape
-- is validated in the API layer by zod.
--
-- RLS is enabled with no policies. The API reads and writes this table with
-- the service role; anon and authenticated are denied by default. Payment
-- configuration is not public data, and a table with RLS on and no policy is
-- the least surprising way to say so.
-- ---------------------------------------------------------------------------

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

comment on table public.app_settings is
  'Owner-editable configuration. Read/written by the API with the service role; no public policies.';

alter table public.app_settings enable row level security;

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: payment providers
--
-- Every provider the salon might accept is present and enabled. `default` is
-- what a future deposit flow preselects; it is not a commitment that the
-- provider is integrated. `enabled` means "show this as an option", which is
-- exactly what the owner asked for.
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value)
values (
  'payments.providers',
  jsonb_build_object(
    'default', 'cash',
    'options', jsonb_build_array(
      jsonb_build_object('id', 'cash',          'label', 'Cash',          'enabled', true),
      jsonb_build_object('id', 'gcash',         'label', 'GCash',         'enabled', true),
      jsonb_build_object('id', 'maya',          'label', 'Maya',          'enabled', true),
      jsonb_build_object('id', 'card',          'label', 'Card',          'enabled', true),
      jsonb_build_object('id', 'bank_transfer', 'label', 'Bank transfer', 'enabled', true)
    )
  )
)
on conflict (key) do nothing;
