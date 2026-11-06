-- ---------------------------------------------------------------------------
-- Deposit settlement.
--
-- A deposit that has been paid must be able to end somewhere when the booking
-- does not happen. Without these two states a cancelled booking keeps a PAID
-- deposit forever, which is not an audit trail - it is a hole.
--
-- The decision is the owner's, not the code's: `deposit.policy.onCancel` says
-- whether a cancellation refunds the deposit, forfeits it, or forfeits it only
-- inside the cancellation window. A no-show always forfeits.
-- ---------------------------------------------------------------------------

alter table public.booking_deposits
  drop constraint if exists booking_deposits_status_check;

alter table public.booking_deposits
  add constraint booking_deposits_status_check
  check (status in ('DUE', 'PAID', 'WAIVED', 'REFUNDED', 'FORFEITED'));

comment on column public.booking_deposits.status is
  'DUE - owed; PAID - held; WAIVED - no longer owed; REFUNDED / FORFEITED - terminal after cancellation or no-show.';
