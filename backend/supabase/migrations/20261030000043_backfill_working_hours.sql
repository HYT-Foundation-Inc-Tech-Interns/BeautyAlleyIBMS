-- ---------------------------------------------------------------------------
-- Every active stylist gets the house rota if they have none.
--
-- `get_available_slots` inner-joins `working_hours`, so an employee with no rows
-- there is not "off, with no times" - they are absent from every booking grid
-- and every stylist picker, and nothing in the UI says why. Before commit
-- a5b68ec, `create_employee` wrote the roster row and its qualifications but no
-- rota, so every stylist created through "issue a team login" was permanently
-- unbookable. That commit fixed the create path; this repairs the rows it left
-- behind, which is what made a newly added stylist invisible on the desk's
-- booking page long after the code was fixed.
--
-- Deliberately narrow:
--   * active only - a retired stylist does not need a schedule;
--   * only employees with *no* hours at all - an empty rota is a legitimate
--     state (indefinite leave, a booking-only freelancer), and someone with a
--     part-time rota must not be given a second, overlapping shift.
-- ---------------------------------------------------------------------------

insert into public.working_hours (employee_id, weekday, start_time, end_time)
select e.id, d.weekday, time '09:00', time '18:00'
  from public.employees e
  cross join generate_series(1, 6) as d(weekday)
 where e.is_active
   and not exists (
     select 1
       from public.working_hours wh
      where wh.employee_id = e.id
   )
on conflict on constraint working_hours_unique do nothing;
