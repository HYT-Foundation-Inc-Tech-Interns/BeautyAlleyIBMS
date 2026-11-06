-- ---------------------------------------------------------------------------
-- Booking deposits.
--
-- A booking may carry a deposit obligation. It is a *record*, not a payment
-- method: the desk can mark it paid for cash, or a client can pay it through
-- whichever gateway is configured. The signed webhook is the only automated
-- path that can set status = PAID.
--
-- Deliberately NOT a column on bookings: a booking may have no deposit, one
-- deposit, or (after a waive) no obligation, and the audit of how it was
-- settled belongs in its own row.
-- ---------------------------------------------------------------------------

create table if not exists public.booking_deposits (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null unique references public.bookings (id) on delete cascade,
  amount_cents  integer not null check (amount_cents > 0),
  status        text not null default 'DUE'
                check (status in ('DUE', 'PAID', 'WAIVED')),
  provider      text not null default 'test-gateway'
                check (provider in ('test-gateway', 'hitpay', 'manual')),
  -- The reference sent to the gateway / webhook. Stable for the life of the
  -- deposit, so a reschedule does not break an in-flight payment.
  provider_ref  text unique,
  paid_at       timestamptz,
  marked_by     uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists booking_deposits_status_idx
  on public.booking_deposits (status)
  where status = 'DUE';

comment on table public.booking_deposits is
  'Deposit obligation for a booking. Only a signed webhook or the desk may mark it PAID.';

alter table public.booking_deposits enable row level security;
grant all on public.booking_deposits to service_role;

-- The owner-editable policy. Disabled by default, so enabling deposits is an
-- explicit decision and every existing booking/test is unaffected.
insert into public.app_settings (key, value)
values ('deposit.policy', '{"enabled":false,"amountCents":50000}'::jsonb)
on conflict (key) do nothing;
