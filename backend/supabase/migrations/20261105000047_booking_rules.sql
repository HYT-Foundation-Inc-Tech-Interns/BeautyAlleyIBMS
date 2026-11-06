-- ---------------------------------------------------------------------------
-- booking.rules
--
-- Two rules the owner changes without a deploy:
--
--   cancellationWindowHours  how late a client may cancel before the desk has
--                            to override. Currently passed to cancel_booking()
--                            from CANCELLATION_WINDOW_HOURS.
--   arrivalWindowMinutes     how early a pass opens before the appointment.
--                            Currently passed to check_in_booking() and to the
--                            pass renderer from QR_CHECKIN_WINDOW_MINUTES.
--
-- Both were deployment environment variables. That is the wrong home for a
-- business policy: the person who decides "we need four hours' notice" is the
-- owner, not whoever can edit Vercel. The env values stay as the fallback for
-- a database that has not been migrated yet, so behaviour does not change on
-- deploy.
--
-- The seeded values match the current production env (2 hours, 60 minutes).
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value)
values (
  'booking.rules',
  jsonb_build_object(
    'cancellationWindowHours', 2,
    'arrivalWindowMinutes', 60
  )
)
on conflict (key) do nothing;
