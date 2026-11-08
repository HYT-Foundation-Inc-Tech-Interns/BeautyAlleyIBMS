# The Beauty Alley — User manual

The salon's booking, front-desk and floor system. One website serves two
audiences: a public booking site for guests, and a staff console behind a
sign-in. Same address, different doors.

| | Address |
|---|---|
| Public site | `https://beautyalleyibms.vercel.app` |
| Staff console | `https://beautyalleyibms.vercel.app/login`, then `/app` |

There is no "sign up". Accounts are created by the administrator; a guest books
without one.

---

## 1. Who sees what

| Role | Can open | The job |
|---|---|---|
| **Administrator** | Everything | Runs the business: prices, treatments, team, promos, client records, reports |
| **Concierge** | Overview, Bookings, Promo codes, Arrivals, Task board, Insights, Settings | Runs the desk: takes bookings, receives guests, assigns work |
| **Employee** | Overview, Bookings (own chair), Arrivals, My tasks, Attendance, Settings | Works the floor: their appointments, the door, their own clock |
| **Client** | My bookings, Settings | Sees their own appointments and passes |

If a screen is missing from the sidebar, that role does not have it — the API
would refuse anyway. Nothing is hidden that could be opened by guessing a link.

## 2. Signing in

1. Go to `/login`, enter email and password.
2. You land on the page for your role.
3. **Wrong password** — the form says so and keeps your email; retype it.
4. **Locked** — five wrong attempts lock the account briefly; the message tells
   you how many minutes. Wait it out rather than trying again.
5. **Disabled** — the account was switched off by the owner. Retrying will never
   work; ask for it to be re-enabled.

Sign out from the account menu in the console header. Closing the tab does not
sign you out on a shared counter machine — sign out properly.

## 3. A guest books online

1. Open the site → **Services** to browse, or **Book** to start.
2. Pick one treatment. (One per booking: the length of the appointment is the
   length of that treatment.)
3. Pick a day, then a time. Only times the salon can actually serve are offered.
4. Enter name and phone. An account is optional; if you are signed in, the
   booking is attached to your record instead.
5. Confirm. You get a **pass** — booking code, date and time, stylist, and a QR
   code.

Keep the pass link: it is the only way back to the booking without an account.
Do not forward it — whoever holds the link can show it at the door.

## 4. The pass and arrival

The pass is the guest's ticket. At the salon:

- **Guest shows the QR** → the desk scans it in **Scan arrivals**. The guest and
  their booking appear, and the desk presses **Confirm arrival**. Scanning alone
  changes nothing, deliberately: the desk gets to look first.
- **A pass can be used once.** A second scan is refused as already used.
- **The stylist** can also record arrival from **Check-in**, on their own chair.

If a guest lost the link, the desk finds the booking in **Bookings** and can
reissue or check in from there.

## 5. The desk — a day at the counter

**Before opening**

1. **Overview** — today's count, arrivals due, anything unassigned.
2. **Bookings** — read the run sheet for the day; note who is in and when.
3. **Tasks** — anything left from yesterday that is still open.

**Taking a booking at the counter** (`Bookings → New booking`)

1. **Treatment** — search the menu, pick one.
2. **When** — day and time. The day's availability is shown as a whole.
3. **Who** — search the client book by name, phone or email; for someone new,
   just take a name and phone.
4. **Stylist** — the list only offers stylists who perform that treatment and are
   free at that time. If it is empty, that time genuinely has nobody: change the
   time, not the stylist.
5. Add a promo code if the guest has one — the discount shows before you confirm.
6. Notes are for the floor: allergies, preferences, "running late".
7. Confirm → the pass appears. **Print it** and hand it over. No payment is taken
   at this point.

**Receiving a guest** — `Arrivals`: scan the pass, or paste the reference, then
confirm. A mis-scan cannot admit the wrong guest, because the name is shown
before anything is written.
**Assigning work** — `Task board`: write the task, choose the assignee, save. It shows
up on their phone immediately; there is only one copy of a task.
**Proposing a promo** — `Promo codes → propose`. It is inert until the administrator
approves it; the row tells you which state it is in.
**The week** — `Insights` is the owner's report, readable by the desk: revenue,
completion, no-shows, the week's curve, top treatments.

## 6. The floor — a stylist's day

1. **Overview** — your day at a glance.
2. **Bookings** — your chair only. The system scopes it; you cannot see, and
   cannot accidentally edit, a colleague's bookings.
3. **Check-in** — when your guest arrives, record it here.
4. **My tasks** — the work the desk assigned. Move it to in progress, then done,
   and say what happened. The desk sees the same status.
5. **Attendance** — time in when you start, time out when you finish. Hours are
   calculated from those two stamps; nothing is filled in for you.

## 7. The administrator

**Treatments** (`Services`) — the menu is data, not code. Adding or repricing a
treatment changes the public site, the booking page and availability at once.
**Retire, don't delete**: a retired treatment leaves the booking menu but stays
on the bookings that sold it.

**Team** (`Team`) — add a person, give them a role and the treatments they
perform. Two things make a stylist bookable: they must perform the treatment,
and they must have **working hours**. A new stylist starts on the house pattern
— Monday to Saturday, 09:00–18:00 — and the week is changed per person under
**Show details → Weekly hours**: one or more windows a day, split shifts
included. A closed day has no slots, and a stylist with no windows at all is
offered nowhere. Saving the week also updates the leave board's cover counts.

**Promos** (`Promos`) — proposals from the desk arrive as pending. Approve to make
a code live, or reject with a reason. Retiring a code stops new redemptions and
keeps the history.

**Clients** (`Clients`) — bookings, lifetime value and last visit per client,
exportable to CSV with identical numbers. Deactivating is a soft delete: the
history stays, the client leaves the active list.

**Insights** (`Insights`) — the monitoring view. Tiles are draggable and the layout is
remembered on your device. Every number is read live from the database.

## 8. When something looks wrong

| What you see | What it means | Do this |
|---|---|---|
| "You do not have access" | That screen is not part of your role | Use your own screens; ask the owner if you think it should be |
| A stylist is missing from the booking list | Not qualified for that treatment, no working hours, or already booked at that time | Check Team: treatments + rota, then check the time |
| "Nobody is free at that time" | Genuinely no qualified stylist free | Change the time or the day; do not force it |
| Pass refused at the door | Already used, or the token was altered | Look the guest up in Bookings and check them in from there |
| Login says locked | Five wrong attempts | Wait the stated minutes |
| A record you created is not there | Note the name, time and page, and report it immediately | This should never happen; it is treated as an incident |
| Page loads but everything is empty | The API is down, not the data | Check `/health`; if it is not 200, report it |

## 9. House rules

1. **Never run database setup scripts against the live system.** Seeding,
   restoring and demo resets are destructive and refuse to run in production —
   if one ever asks to proceed, stop and ask.
2. **One treatment per booking.** Two treatments need two bookings; the system
   cannot yet check a combined length against a stylist's shift.
3. **A pass is a ticket.** Treat the link like a key: send it to the guest only.
4. **Retire, don't delete** — treatments, promos and clients all keep their
   history this way.
5. **Report, don't retry.** If a write fails, say what you did; repeating it can
   create a duplicate.
