-- ---------------------------------------------------------------------------
-- Built-in test gateway.
--
-- No external payment provider, no merchant verification, no API key: the
-- owner can walk a deposit through a hosted checkout, pay (or cancel), and see
-- a signed webhook mark it PAID. It exercises the exact same state machine a
-- real HitPay/Stripe integration will use, so that wiring can be built and
-- tested before any payment account is approved.
--
-- These rows are TEST payments only. They are never attached to a booking and
-- never represent money.
-- ---------------------------------------------------------------------------

create table if not exists public.test_payment_requests (
  id           uuid primary key default gen_random_uuid(),
  reference    text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  currency     text not null default 'PHP',
  status       text not null default 'PENDING'
               check (status in ('PENDING', 'PAID', 'CANCELLED')),
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);

create index if not exists test_payment_requests_status_idx
  on public.test_payment_requests (status, created_at);

comment on table public.test_payment_requests is
  'Test-only payment requests for the built-in deposit simulator. Never attached to a booking; never real money.';

alter table public.test_payment_requests enable row level security;
grant all on public.test_payment_requests to service_role;
