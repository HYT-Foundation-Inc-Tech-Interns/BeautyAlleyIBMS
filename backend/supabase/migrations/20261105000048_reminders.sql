-- ---------------------------------------------------------------------------
-- Reminder outbox.
--
-- A booking gets two reminders: 24 hours and 2 hours before it starts. They
-- are written to a queue by a trigger, not by the API, because a booking can be
-- created, moved or cancelled from four different code paths and the queue must
-- agree with all of them.
--
-- The sender is `scripts/reminders.js`; it runs on a schedule (or by hand) and
-- marks each row SENT, FAILED or SKIPPED. Keeping the send outside the request
-- means a slow SMTP server never holds a booking response open, and a failed
-- send is retried on the next run rather than lost.
--
-- `channel` exists now even though only email is implemented: SMS is the same
-- queue with a different sender, not a second table.
-- ---------------------------------------------------------------------------

create table if not exists public.reminder_outbox (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  kind        text not null check (kind in ('24h', '2h')),
  channel     text not null default 'email' check (channel in ('email', 'sms')),
  send_at     timestamptz not null,
  status      text not null default 'PENDING'
              check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts    integer not null default 0,
  last_error  text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),

  -- One reminder of each kind per booking. A reschedule updates the row; it
  -- must not create a second reminder for the same appointment.
  unique (booking_id, kind)
);

create index if not exists reminder_outbox_due_idx
  on public.reminder_outbox (send_at)
  where status = 'PENDING';

create index if not exists reminder_outbox_booking_idx
  on public.reminder_outbox (booking_id);

comment on table public.reminder_outbox is
  'Queued booking reminders. The trigger keeps it in step with bookings; scripts/reminders.js sends and marks them.';

alter table public.reminder_outbox enable row level security;

-- Only the sender (service role) touches this table. No policies on purpose:
-- a client must never be able to read another guest's reminder.
grant all on public.reminder_outbox to service_role;

-- ---------------------------------------------------------------------------
-- Keep the queue in step with the booking.
-- ---------------------------------------------------------------------------

create or replace function public.sync_booking_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status in ('PENDING', 'CONFIRMED') then
    /*
     * Only enqueue a reminder that is still in the future. A booking made
     * three hours before it starts should not immediately fire a "24 hours
     * from now" email; the 2-hour one is the useful one.
     */
    if NEW.start_time - interval '24 hours' > now() then
      insert into public.reminder_outbox (booking_id, kind, send_at)
      values (NEW.id, '24h', NEW.start_time - interval '24 hours')
      on conflict (booking_id, kind) do update
        set send_at    = excluded.send_at,
            status     = case when reminder_outbox.status = 'SENT' then 'SENT' else 'PENDING' end,
            last_error = null
        where reminder_outbox.status <> 'SENT';
    end if;

    if NEW.start_time - interval '2 hours' > now() then
      insert into public.reminder_outbox (booking_id, kind, send_at)
      values (NEW.id, '2h', NEW.start_time - interval '2 hours')
      on conflict (booking_id, kind) do update
        set send_at    = excluded.send_at,
            status     = case when reminder_outbox.status = 'SENT' then 'SENT' else 'PENDING' end,
            last_error = null
        where reminder_outbox.status <> 'SENT';
    end if;
  end if;

  -- A cancelled or finished appointment has nothing left to remind anyone
  -- about. Rows already SENT stay as the record that they went out.
  if NEW.status in ('CANCELLED', 'COMPLETED', 'NO_SHOW') then
    update public.reminder_outbox
       set status = 'SKIPPED'
     where booking_id = NEW.id
       and status = 'PENDING';
  end if;

  return NEW;
end $$;

comment on function public.sync_booking_reminders() is
  'Queues 24h/2h reminders on booking insert or reschedule, and skips them on cancel/complete/no-show.';

drop trigger if exists bookings_sync_reminders on public.bookings;
create trigger bookings_sync_reminders
  after insert or update of start_time, status on public.bookings
  for each row execute function public.sync_booking_reminders();
