/**
 * The route table.
 *
 * Two halves, and the split is the point of the whole exercise:
 *
 *   **Public** — `/`, `/services`, `/book`, `/pass/:id`, `/login`. These render their own shell (`PublicShell` or `AuthLayout`)
 *   because a visitor has no sidebar and no session. Booking is reachable
 *   signed out, which is the guest flow the salon actually runs on.
 *
 *   **Kiosk** — `/kiosk`, the tablet by the door. Outside `RequireAuth` and
 *   outside `AppShell`, and it has no session at all: its credential is a
 *   device token carried in the URL fragment on first boot. It also lives on
 *   the public origin, because that is where the tablet is pointed and where
 *   the guest-facing brand lives.
 *
 *   **Console** — everything under `/app`. One `AuthProvider` decides who you
 *   are, `RequireAuth` bounces an anonymous visitor to `/login` (remembering
 *   where they were headed), and `RequireArea` gates each room against the
 *   permission map. A client who guesses `/app/promos` gets a polite refusal,
 *   not a blank page — and the API would refuse them anyway.
 *
 * The guards are ergonomics; the API and RLS are the boundary. See
 * `src/auth/AuthProvider.tsx`.
 */

import { Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider, homeFor, useAuth } from "@/auth/AuthProvider";
import { RequireArea, RequireAuth } from "@/auth/guards";
import { AppShell } from "@/components/app/AppShell";

import Landing from "@/pages/Landing";
import Services from "@/pages/Services";
import Book from "@/pages/Book";
import Pass from "@/pages/Pass";
import Login from "@/pages/Login";
import Kiosk from "@/pages/Kiosk";

import Overview from "@/pages/Overview";
import Bookings from "@/pages/Bookings";
import NewBooking from "@/pages/NewBooking";
import Clients from "@/pages/Clients";
import Promos from "@/pages/Promos";
import Arrivals from "@/pages/Arrivals";
import DepositMock from "@/pages/DepositMock";
import Team from "@/pages/Team";
import ServicesAdmin from "@/pages/ServicesAdmin";
import Insights from "@/pages/Insights";
import Tasks from "@/pages/Tasks";
import MyTasks from "@/pages/MyTasks";
import Attendance from "@/pages/Attendance";
import MyBookings from "@/pages/MyBookings";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/NotFound";

/**
 * `/app` itself.
 *
 * Overview is the admin and staff landing page, but a client cannot see it —
 * and if this simply rendered `<Overview/>` behind `RequireArea`, a client
 * would get the refusal screen whose "Back to the console" button returns them
 * to `/app` and the refusal again. So the index asks where this role actually
 * belongs and sends them there.
 */
function ConsoleIndex() {
  const { role, can } = useAuth();
  if (role && !can("overview")) return <Navigate to={homeFor(role)} replace />;
  return <Overview />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* ------------------------------------------------- public */}
        <Route path="/" element={<Landing />} />
        <Route path="/services" element={<Services />} />
        <Route path="/book" element={<Book />} />
        <Route path="/pass/:id" element={<Pass />} />
        {/*
          * No /register. Accounts are created by an administrator inside the
          * console; a visitor books as a guest and is never offered a door to
          * make themselves an identity in the salon's system.
          */}
        <Route path="/login" element={<Login />} />
        <Route path="/deposit/mock" element={<DepositMock />} />

        {/*
          * The door tablet. No `RequireAuth` on purpose - it is not a person,
          * and it has no session to require. Its token arrives in the URL
          * fragment (`#t=…`) the first time the owner opens the link, and the
          * page strips it from the address bar as soon as it has read it.
          */}
        <Route path="/kiosk" element={<Kiosk />} />

        {/* ------------------------------------------------ console */}
        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<ConsoleIndex />} />
          <Route
            path="bookings"
            element={
              <RequireArea area="bookings">
                <Bookings />
              </RequireArea>
            }
          />
          {/* The desk books here, in the console — not on the public page. */}
          <Route
            path="bookings/new"
            element={
              <RequireArea area="bookings">
                <NewBooking />
              </RequireArea>
            }
          />
          <Route
            path="clients"
            element={
              <RequireArea area="clients">
                <Clients />
              </RequireArea>
            }
          />
          <Route
            path="promos"
            element={
              <RequireArea area="promos">
                <Promos />
              </RequireArea>
            }
          />
          <Route
            path="services"
            element={
              <RequireArea area="services">
                <ServicesAdmin />
              </RequireArea>
            }
          />
          <Route
            path="team"
            element={
              <RequireArea area="employees">
                <Team />
              </RequireArea>
            }
          />
          {/* One arrivals surface. The old two routes redirect into the mode
              they used to be, so bookmarks and the pilot's own links survive. */}
          <Route
            path="arrivals"
            element={
              <RequireArea area="arrivals">
                <Arrivals />
              </RequireArea>
            }
          />
          <Route path="check-in" element={<Navigate to="/app/arrivals?mode=quick" replace />} />
          <Route path="scan-arrivals" element={<Navigate to="/app/arrivals?mode=confirm" replace />} />
          <Route
            path="tasks"
            element={
              <RequireArea area="tasks">
                <Tasks />
              </RequireArea>
            }
          />
          <Route
            path="my-tasks"
            element={
              <RequireArea area="my-tasks">
                <MyTasks />
              </RequireArea>
            }
          />
          <Route
            path="attendance"
            element={
              <RequireArea area="attendance">
                <Attendance />
              </RequireArea>
            }
          />
          {/* The performance surface. `/app/board` was its old name; the
              redirect keeps bookmarks and the pilot's own links working. */}
          <Route
            path="insights"
            element={
              <RequireArea area="insights">
                <Insights />
              </RequireArea>
            }
          />
          <Route path="board" element={<Navigate to="/app/insights" replace />} />
          <Route
            path="my-bookings"
            element={
              <RequireArea area="my-bookings">
                <MyBookings />
              </RequireArea>
            }
          />
          {/* One settings page for every role; the sections inside it are
              gated by role, so a client sees only their own password form. */}
          <Route
            path="settings"
            element={
              <RequireArea area="settings">
                <Settings />
              </RequireArea>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
