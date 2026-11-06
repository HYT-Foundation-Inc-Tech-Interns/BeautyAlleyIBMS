# The Beauty Alley — UAT script

**What this is.** A scripted acceptance pass over the pilot system. Every case is
something the salon will actually do on opening day, written so a non-developer
can run it and mark it pass or fail.

**Environment.** Pilot: `https://beautyalleyibms.vercel.app` (site + API on one origin).
Console: the same host under `/app`.

**Before you start**

1. Open `https://beautyalleyibms.vercel.app/health` — it must return `200` with
   `"database":"ok"`. If not, stop and report; nothing below will work.
2. Have one browser window for the guest flow (signed out, or a private window)
   and one for the console.
3. Passwords are issued separately — never write them into this document.
4. Where a case creates data, put **UAT** plus your initials in the guest name
   (e.g. `UAT-JD`) so the rows are easy to find afterwards.

**Accounts**

| Role | Email | Lands on |
|---|---|---|
| Administrator | admin@beautyalley.ph | `/app` (business summary) |
| Concierge | concierge@beautyalley.ph | `/app` (desk summary) |
| Employee (stylist) | stylist@beautyalley.ph | `/app` (own chair) |
| Client | client@beautyalley.ph | `/app/my-bookings` |

**Recording results.** Mark **P** (pass), **F** (fail) or **N/A**. A fail needs the
step number, what you saw, and a screenshot. Do not retry a failed write more
than twice — a repeated write can look like a duplicate booking.

---

## A. Public site — the guest

| ID | Do this | Expect |
|---|---|---|
| TC-01 | Open `/` | Landing page renders; header is Home / Scan & Check In / Services; the two main buttons lead to `/services` and `/book`. No "open console" link anywhere, no staff sign-in in the nav or footer. |
| TC-02 | Open `/services` | Treatments listed with price and duration, grouped by category (Haircut & Salon Services, IV Drips, Beauty Shots, Add-ons). Every treatment shown here is also selectable on `/book`. |
| TC-03 | Open `/book`, pick a treatment | Date chips appear; choosing a day shows only times the salon can actually serve — no time that is outside opening hours or already full. Changing the treatment resets the chosen time. |
| TC-04 | Complete a booking as a guest: name + phone, pick a time, submit | Confirmation with a pass: booking code, treatment, date and time, stylist name, QR code. The phone field refuses obvious junk (fewer than 7 digits, letters). |
| TC-05 | Open the pass URL in a private window (not signed in) | The pass loads — a guest has no account, so the link itself is the access. Change one character in the URL and it must show "not found", not someone else's booking. |
| TC-06 | Open `/login`, enter a valid email with a wrong password | A plain "email or password is incorrect" message; the email stays filled in. Five wrong attempts on the same account locks it for a while and the message says how many minutes. **Only test the lockout on a throwaway account** — do not lock the demo logins. |

## B. Sign-in and access control

| ID | Do this | Expect |
|---|---|---|
| TC-07 | Sign in as each of the four accounts | Administrator and Concierge land on the overview; Employee lands on the overview showing their own day; Client lands on **My bookings**. |
| TC-08 | As the Client, type `/app/promos` in the address bar | A polite "you do not have access" screen with a way back — not a blank page, not a crash. Repeat for `/app/team` and `/app/clients`. |
| TC-09 | Sign out, then open `/app/bookings` directly | You are sent to `/login`; after signing in you land back on the page you asked for. |

## C. Desk booking — the counter

| ID | Do this | Expect |
|---|---|---|
| TC-10 | Sign in as **Concierge** → `/app/bookings/new` | Three steps: treatment (searchable), when (day + time), who (client search or walk-in guest). The whole day's availability is visible at a glance, not one stylist at a time. |
| TC-11 | Pick a treatment and a time, then look at the **Stylist** list | Only stylists who (a) are active, (b) perform that treatment, and (c) are free at that exact time. Change the time — the list changes with it. Nobody free shows "nobody is free at that time", never a stale name. |
| TC-12 | Book for an existing client: search by name, phone or email | The client's record is selected (name shown in the summary), no guest fields required. Confirming issues the pass immediately — no payment step. |
| TC-13 | Book a walk-in: skip the client search, enter guest name + phone | Same result; the booking is created against the guest details and the pass is ready to print. |
| TC-14 | Enter a valid promo code in the summary | The discount appears in the summary before confirming. An unknown or expired code is refused with a readable reason, not a silent no-op. |
| TC-15 | **New stylist check.** In Team (as Administrator) create a stylist who performs the treatment you are testing, give them working hours, then return to `/app/bookings/new` and refresh | The new stylist appears in the Stylist list for days they are rostered. Clear their working hours and they disappear from the list — no code change, no deploy. |
| TC-16 | Try to book the same stylist at a time they are already booked | The booking is refused with a clear "already booked" message; the existing booking is untouched. |
| TC-17 | Open `/app/bookings` | The run sheet lists the bookings you just created. Concierge and Administrator see the whole branch; an Employee sees only their own chair. |

## D. Arrival and check-in

| ID | Do this | Expect |
|---|---|---|
| TC-18 | Sign in as **Concierge** → `/app/arrivals` (Scan & confirm), paste a pass token (`BA1.…`) | The guest and their booking are shown for confirmation. **Nothing is written yet.** Press *Confirm arrival* and the booking moves to arrived/checked in. |
| TC-19 | Scan the same pass a second time | It is refused as already used. A forged or truncated token is refused as invalid — no booking is marked. |
| TC-20 | Sign in as **Employee** → `/app/arrivals?mode=quick` | The stylist can record arrival on their own booking. A booking that is not theirs is not offered. |
| TC-21 | Sign in as **Client** → `/app/my-bookings`, press **Move** on an upcoming booking, choose another open time | The success notice and the booking card show the new time immediately. The old slot is free again. |
| TC-22 | Press **Cancel** on the same booking, add a reason, confirm | The row leaves Upcoming, the pass stops working, and the reason is recorded. Inside the cutoff the server refuses and the desk must override. |

## E. Administration

| ID | Do this | Expect |
|---|---|---|
| TC-21 | As **Administrator** → `/app/services`, add a treatment (name, price, duration, category) | It appears on `/services` and in `/book` straight away, in the right category. **Retire** it and it disappears from booking, while past bookings still show the name they were sold under. |
| TC-22 | `/app/team`, add an employee with a role and the treatments they perform | The employee appears in the list. No working hours yet — they are not bookable until a rota is set (see TC-15). |
| TC-23 | `/app/promos` as Concierge: propose a code. Then as Administrator, open `/app/promos` | The Administrator sees a pending queue first. Approve → the code becomes live and works in TC-14. Reject with a reason → the row shows REJECTED and the reason, and the code never works. |
| TC-24 | `/app/clients` | Each client shows bookings, lifetime value and last visit. Export the CSV — the numbers match the screen exactly. Deactivate a client: they leave the active list but their history is kept. |
| TC-25 | `/app/board` | Tiles show live numbers (not fixtures). Drag a tile to a new position, reload the page — the arrangement is remembered on that device. |

## F. Floor and client

| ID | Do this | Expect |
|---|---|---|
| TC-26 | As Concierge, create a task in `/app/tasks` assigned to the stylist. Then sign in as the Employee → `/app/my-tasks` | The task is there. Move it to in-progress/done — the desk's board shows the same status, and the stylist cannot see a colleague's task. |
| TC-27 | As Employee → `/app/attendance` | Time in and time out are recorded against the real clock; hours are computed. There is no invented "late" verdict and no row for a day nobody clocked in. |
| TC-28 | As Client → `/app/my-bookings` | Only that client's own appointments, each with a link to its pass. An account with no bookings shows an empty state, not an error. |

## G. Data safety — the regression that started this pass

| ID | Do this | Expect |
|---|---|---|
| TC-29 | Create a booking, a client and an employee. Wait 10 minutes, reload, then ask for a redeploy of the same commit | **All three still exist.** Nothing on deploy, startup or health-check path reseeds, restores or truncates. |
| TC-30 | (Technical, on a development machine only) Run `npm run db:seed` with `NODE_ENV=production` | It refuses and says why. Same for `db:restore` and `reset-demo-data`. A destructive command must never run silently against the pilot database. |

---

## Sign-off

| | Name | Date | Result |
|---|---|---|---|
| Tested by | | | |
| Reviewed by (salon owner) | | | |

**Blocking** means any F in sections A, C, D or G. Those are the paths the salon
touches every day; the rest can be scheduled fixes.
