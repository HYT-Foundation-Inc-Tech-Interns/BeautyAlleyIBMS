-- Promo codes are proposed by the desk and approved by the administrator.
--
-- Before this migration every promo was created by an ADMIN and was live the
-- moment it was inserted. The front desk is the party that actually knows what
-- the floor is running this week, so it proposes a code; nothing about the code
-- is live until the administrator approves it.
--
--   PENDING   proposed by the concierge, invisible to clients (is_active false)
--   APPROVED  approved by the administrator, live if is_active
--   REJECTED  refused, with the reason in review_note
--
-- Existing rows default to APPROVED: they were created under the old rule and
-- are already in circulation, so they must not disappear from the catalogue.

alter table public.promo_codes
  add column if not exists status text not null default 'APPROVED'
    check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  add column if not exists requested_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

comment on column public.promo_codes.status is
  'PENDING = proposed by the desk, waiting on the administrator. Only APPROVED codes can be redeemed.';
comment on column public.promo_codes.requested_by is
  'The profile that proposed the code. Null for codes created by an administrator.';

-- The approval queue is read by status, newest first.
create index if not exists promo_codes_status_idx
  on public.promo_codes (status, created_at desc);
