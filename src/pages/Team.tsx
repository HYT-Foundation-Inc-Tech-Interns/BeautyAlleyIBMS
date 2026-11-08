"use client";

/**
 * The employee record.
 *
 * Two things worth stating, because the screen could easily imply otherwise.
 *
 * **Working hours are read separately, because the public shape omits them.**
 * `GET /employees/:id` always passes `publicView = true`, so it carries
 * `serviceIds` but no `workingHours` — those are an internal scheduling detail
 * with no RLS policy for a browser. The editor therefore reads
 * `GET /employees/:id/working-hours`, which sits behind the same admin guard as
 * the write, and only while a card is open. An empty answer is a real state:
 * `get_available_slots` inner-joins the table, so no windows means the stylist
 * is offered nowhere.
 *
 * **Issuing a login is the only way to create a team account.** The role is
 * written to `app_metadata`, which only the service role can set, so this goes
 * through `POST /admin/users/staff` rather than through public registration.
 * That is why the form is here and not on the sign-up page. The endpoint name
 * is a leftover — it now issues EMPLOYEE, CONCIERGE and ADMIN accounts, and
 * refuses the retired 'STAFF' label.
 */

import * as React from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  Check,
  ChevronDown,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { branchDay, branchTime, branchToday, cn, shiftDayKey } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Employee, LeavePerson, Service, StaffLogin, WorkingHour } from "@/lib/api-types";
import { ROLE_LABEL } from "@/auth/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, StatTile } from "@/components/app/bits";
import { EmptyNote, ErrorNote, Loading, PersonAvatar, TextField } from "@/components/app/api-bits";

export default function Team() {
  const [includeInactive, setIncludeInactive] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [inviting, setInviting] = React.useState(false);

  const roster = useAsync(`team:${includeInactive}`, () =>
    api.admin.employees({ limit: 100, includeInactive, sort: "full_name", order: "asc" }),
  );

  // Only needed to turn a service uuid into a readable name.
  const catalogue = useAsync("team:services", async () => (await api.services.list({ limit: 100 })).data);

  /*
   * The logins that are not attached to a roster row. Fetched only while a
   * card is open, because that is the only place the control exists - and
   * refetched per card, since linking one removes it from the list.
   */
  const logins = useAsync(`team:logins:${expanded ?? "closed"}`, async () => {
    if (!expanded) return [];
    return api.admin.staffLogins();
  });

  const rows = roster.data?.data ?? [];

  /*
   * The public employee endpoint hides deactivated staff through RLS, so
   * asking it about a retired record is a 404 rather than an empty answer. The
   * card says why instead of firing a request that cannot succeed.
   */
  const expandedActive = rows.find((p) => p.id === expanded)?.isActive ?? false;
  const detail = useAsync(`team:detail:${expanded}:${expandedActive}`, async () => {
    if (!expanded || !expandedActive) return null;
    return api.employees.get(expanded);
  });

  /*
   * The rota, read only while a card is open. It is a second request because
   * the public employee shape does not carry hours - see the file header.
   * Keyed on the person rather than a nonce, so a reload after a save keeps
   * the key and the open editor does not lose its draft.
   */
  const hours = useAsync(`team:hours:${expanded}:${expandedActive}`, async () => {
    if (!expanded || !expandedActive) return [];
    return api.employees.workingHours(expanded);
  });

  /*
   * The leave board's coverage is computed from these windows, so a save has
   * to reach it: it is rendered above the cards and owns its own fetch.
   */
  const [rotaVersion, setRotaVersion] = React.useState(0);

  const serviceName = (id: string) =>
    catalogue.data?.find((s) => s.id === id)?.name ?? "Unknown service";

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<ApiError | null>(null);

  /*
   * Qualifications are a replace, so the editor hands over the whole set.
   * Both views are reloaded afterwards: the card's own list, and the roster,
   * whose "taking bookings" tile is only true for people who are qualified.
   */
  async function saveServices(person: Employee, serviceIds: string[]): Promise<boolean> {
    setBusyId(person.id);
    setActionError(null);
    try {
      await api.employees.setServices(person.id, serviceIds);
      detail.reload();
      roster.reload();
      return true;
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not save those qualifications"),
      );
      return false;
    } finally {
      setBusyId(null);
    }
  }

  /*
   * Hours are a replace too: the body is every window on screen. The card
   * reloads its own pattern, and the leave board is asked to re-read, because
   * its "scheduled" count is exactly "whose pattern includes this weekday".
   */
  async function saveHours(
    person: Employee,
    windows: { weekday: number; startTime: string; endTime: string }[],
  ): Promise<boolean> {
    setBusyId(person.id);
    setActionError(null);
    try {
      await api.employees.setWorkingHours(person.id, windows);
      hours.reload();
      setRotaVersion((v) => v + 1);
      return true;
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not save those hours"),
      );
      return false;
    } finally {
      setBusyId(null);
    }
  }

  /*
   * Attach an existing login to a roster row.
   *
   * This is the repair for accounts made before the console linked the two:
   * the person can sign in, and every screen behind the login says they have
   * no chair. Linking is a PATCH because the row already exists - the account
   * is what was missing from it.
   */
  async function linkLogin(person: Employee, profileId: string): Promise<boolean> {
    setBusyId(person.id);
    setActionError(null);
    try {
      await api.employees.update(person.id, { profileId });
      roster.reload();
      detail.reload();
      logins.reload();
      return true;
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not link that login"),
      );
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(person: Employee) {
    setBusyId(person.id);
    setActionError(null);
    try {
      await api.employees.update(person.id, { isActive: !person.isActive });
      roster.reload();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not update that employee"),
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-7">
      <PageHeader
        eyebrow="Records"
        icon={Scissors}
        title="Team"
        description="Who works the floor, what each of them is qualified to do, and who is off. Qualifications are what the booking engine consults before offering a slot; leave is what takes a day out of it."
        actions={
          <>
            <Button variant="outline" size="icon" aria-label="Refresh" onClick={roster.reload}>
              <RefreshCw className="size-4" />
            </Button>
            <Button
              variant={inviting ? "secondary" : "default"}
              onClick={() => setInviting((v) => !v)}
            >
              {inviting ? <X className="size-4" /> : <UserPlus className="size-4" />}
              {inviting ? "Cancel" : "Issue staff login"}
            </Button>
          </>
        }
      />

      {inviting && (
        <InviteStaffForm
          services={catalogue.data ?? []}
          onDone={roster.reload}
          onCancel={() => setInviting(false)}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="On the roster"
          value={String(rows.length)}
          hint="everyone on the record"
          icon={Users}
        />
        <StatTile
          label="Active"
          value={String(rows.filter((p) => p.isActive).length)}
          hint="taking bookings"
          icon={UserCheck}
          tone="success"
        />
        <StatTile
          label="With a login"
          value={String(rows.filter((p) => p.profileId).length)}
          hint="linked sign-in accounts"
          icon={BadgeCheck}
          tone="accent"
        />
      </div>

      <LeavePanel refreshKey={rotaVersion} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          onClick={() => setIncludeInactive((v) => !v)}
          aria-pressed={includeInactive}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors",
            includeInactive
              ? "border-primary/30 bg-primary/[0.06] text-primary"
              : "border-border text-muted-foreground hover:border-primary/30",
          )}
        >
          {includeInactive ? "Showing deactivated" : "Active only"}
        </button>
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Deactivating retires a stylist from the roster and the booking engine.
          Their bookings and history stay on record.
        </p>
      </div>

      {actionError && <ErrorNote error={actionError} />}

      {roster.error ? (
        <ErrorNote error={roster.error} onRetry={roster.reload} />
      ) : roster.initial ? (
        <Loading label="Fetching the team…" />
      ) : rows.length === 0 ? (
        <EmptyNote
          icon={Scissors}
          title="No employees on the roster"
          description="Nobody is set up to take bookings yet."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((person) => (
            <EmployeeCard
              key={person.id}
              person={person}
              open={expanded === person.id}
              onToggle={() => setExpanded(expanded === person.id ? null : person.id)}
              detail={expanded === person.id ? detail : null}
              hours={expanded === person.id ? hours : null}
              serviceName={serviceName}
              services={catalogue.data ?? []}
              logins={logins.data ?? []}
              busy={busyId === person.id}
              onToggleActive={() => void toggleActive(person)}
              onSaveServices={(ids) => saveServices(person, ids)}
              onSaveHours={(windows) => saveHours(person, windows)}
              onLinkLogin={(profileId) => linkLogin(person, profileId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Leave
 * ------------------------------------------------------------------ */

/** A `YYYY-MM-DD` key -> "Fri 7", without dragging a timezone into it. */
function dayLabel(key: string) {
  return new Date(key + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Fri 7 Nov" for a single day, "Fri 7 – Sun 9 Nov" for a span. */
function leaveRange(startsAt: string, endsAt: string) {
  const first = branchDay(startsAt);
  const last = branchDay(endsAt);
  return first === last ? first : first + " – " + last;
}

/**
 * The rota, as the owner needs it: who is waiting for an answer, and what each
 * of the next two weeks has left.
 *
 * The counts come from the server (get_leave_board), not from subtracting two
 * lists here. A day is "covered" when the people scheduled that weekday minus
 * the ones on approved leave is more than zero - a rule that belongs in one
 * place, because the desk and the owner must not disagree about Thursday.
 */
function LeavePanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const from = branchToday();
  const to = shiftDayKey(from, 13);
  const [nonce, setNonce] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  /*
   * `refreshKey` is the page telling this panel that a weekly pattern changed.
   * Coverage is "whose pattern includes this weekday", so the numbers here are
   * wrong the moment a rota is saved, and the panel owns its own fetch.
   */
  const board = useAsync("team:leave:" + from + ":" + nonce + ":" + refreshKey, () =>
    api.employees.leave({ from, to }),
  );

  async function answer(person: LeavePerson, decision: "approve" | "decline") {
    setBusy(person.id);
    setError(null);
    setNotice(null);
    try {
      await api.employees.decideLeave(person.employeeId, person.id, { decision });
      // The row leaves the queue, so the clash count has to be said out loud
      // or it disappears with it.
      if (decision === "approve" && person.clashes > 0) {
        setNotice(
          "Approved. " +
            person.clashes +
            (person.clashes === 1 ? " appointment now sits" : " appointments now sit") +
            " inside it — listed below to move or call.",
        );
      }
      board.reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not save that decision."),
      );
    } finally {
      setBusy(null);
    }
  }

  const pending = board.data?.pending ?? [];
  const days = board.data?.days ?? [];
  const affected = board.data?.affected ?? [];

  return (
    <section className="rounded-2xl border border-border/70 bg-card/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-[17px] font-semibold tracking-tight">Leave</h2>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Requests waiting on you, and what each of the next two weeks has left.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setNonce((n) => n + 1)}
          disabled={board.loading}
        >
          {board.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Refresh
        </Button>
      </div>

      {error && <ErrorNote error={error} className="mt-3" />}

      {notice && (
        <p className="mt-3 rounded-lg border border-clay/30 bg-clay/[0.05] px-3 py-2 text-[11.5px] text-clay">
          {notice}
        </p>
      )}

      {board.error ? (
        <ErrorNote error={board.error} onRetry={board.reload} className="mt-3" />
      ) : board.initial ? (
        <Loading label="Reading the rota…" className="mt-3" />
      ) : (
        <>
          {pending.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-border/70 px-3 py-2.5 text-[11.5px] text-muted-foreground">
              Nothing waiting. A stylist asks for leave from their attendance page.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {pending.map((person) => (
                <li
                  key={person.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2.5"
                >
                  <PersonAvatar name={person.fullName} className="size-7 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium">{person.fullName}</p>
                    <p className="truncate text-[10.5px] text-muted-foreground">
                      {leaveRange(person.startsAt, person.endsAt)}
                      {person.reason ? " · " + person.reason : ""}
                    </p>
                  </div>
                  {person.clashes > 0 && (
                    <span
                      title="Bookings already sitting inside this range"
                      className="shrink-0 rounded-full border border-clay/30 bg-clay/[0.06] px-2 py-0.5 text-[10px] font-medium text-clay"
                    >
                      {person.clashes} booked
                    </span>
                  )}
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => void answer(person, "approve")}
                      disabled={busy === person.id}
                    >
                      <Check className="size-3.5" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void answer(person, "decline")}
                      disabled={busy === person.id}
                    >
                      <X className="size-3.5" />
                      Decline
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 grid grid-flow-col auto-cols-[minmax(78px,1fr)] gap-2 overflow-x-auto pb-1">
            {days.map((day) => {
              const closed = day.scheduled === 0;
              const uncovered = !closed && day.available === 0;
              const who = day.people.length
                ? day.people.map((p) => p.fullName + " (" + p.status.toLowerCase() + ")").join(", ")
                : "Nobody is off";
              return (
                <div
                  key={day.date}
                  title={who}
                  className={cn(
                    "rounded-xl border px-2 py-2 text-center",
                    closed && "border-border/50 bg-muted/30",
                    uncovered && "border-clay/40 bg-clay/[0.06]",
                    !closed && !uncovered && "border-border/60 bg-background/40",
                  )}
                >
                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {dayLabel(day.date)}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-[15px] font-semibold tabular-nums",
                      closed && "text-muted-foreground",
                      uncovered && "text-clay",
                    )}
                  >
                    {closed ? "—" : day.available + "/" + day.scheduled}
                  </p>
                  <p className="text-[9.5px] text-muted-foreground">
                    {closed ? "closed" : day.approvedOff > 0 ? day.approvedOff + " off" : "full team"}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-[10.5px] text-muted-foreground">
            Available of scheduled, from each stylist's weekly hours. A day turns clay when
            approved leave leaves nobody on the floor.
          </p>

          {affected.length > 0 && (
            <div className="mt-4 rounded-xl border border-clay/30 bg-clay/[0.04] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[12px] font-semibold text-clay">
                  Appointments inside approved leave
                </p>
                <span className="text-[10.5px] text-muted-foreground">
                  {affected.length} to move or call
                </span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {affected.map((booking) => (
                  <li
                    key={booking.bookingId}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11.5px]"
                  >
                    <Link
                      to={"/app/bookings?range=all&q=" + encodeURIComponent(booking.reference)}
                      className="font-mono text-[11px] underline decoration-dotted underline-offset-2 hover:text-clay"
                    >
                      {booking.reference}
                    </Link>
                    <span className="truncate">{booking.clientName ?? "Guest"}</span>
                    <span className="text-muted-foreground">
                      · {booking.employeeName} · {branchDay(booking.startsAt)}{" "}
                      {branchTime(booking.startsAt)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10.5px] text-muted-foreground">
                Move them from the booking, or call the guest. Approving leave never cancels
                anything on its own.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EmployeeCard({
  person,
  open,
  onToggle,
  detail,
  hours,
  serviceName,
  services,
  logins,
  busy,
  onToggleActive,
  onSaveServices,
  onSaveHours,
  onLinkLogin,
}: {
  person: Employee;
  open: boolean;
  onToggle: () => void;
  detail: { data: Employee | null; error: ApiError | null; initial: boolean } | null;
  hours: { data: WorkingHour[] | null; error: ApiError | null; initial: boolean } | null;
  serviceName: (id: string) => string;
  services: Service[];
  logins: StaffLogin[];
  busy: boolean;
  onToggleActive: () => void;
  onSaveServices: (serviceIds: string[]) => Promise<boolean>;
  onSaveHours: (
    windows: { weekday: number; startTime: string; endTime: string }[],
  ) => Promise<boolean>;
  onLinkLogin: (profileId: string) => Promise<boolean>;
}) {
  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card p-5 shadow-soft transition-[border-color,box-shadow,transform] duration-300 ease-out-quart hover:-translate-y-0.5 hover:shadow-lift",
        open ? "border-primary/40 shadow-lift" : "border-border/70",
      )}
    >
      <div className="flex items-start gap-4">
        <PersonAvatar name={person.fullName} className="size-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[18px] font-semibold leading-tight tracking-tight">
            {person.fullName}
          </p>
          {person.title && (
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-primary">
              <Sparkles className="size-3" />
              {person.title}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant={person.isActive ? "success" : "secondary"}>
              {person.isActive ? "Active" : "Deactivated"}
            </Badge>
            {person.profileId && (
              <Badge variant="outline" title="Linked to a sign-in account">
                <BadgeCheck className="size-3" />
                Has login
              </Badge>
            )}
          </div>
        </div>
      </div>

      {person.bio && (
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">{person.bio}</p>
      )}

      {open && (
        <div className="mt-4 border-t border-border/70 pt-4">
          {!person.isActive ? (
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              This record is deactivated. Reactivate it to see the treatments
              they are qualified for.
            </p>
          ) : detail?.error ? (
            <ErrorNote error={detail.error} />
          ) : detail?.initial ? (
            <Loading label="Loading the record…" className="py-6" />
          ) : detail?.data ? (
            <>
              {!person.profileId && (
                <LinkLogin logins={logins} busy={busy} onLink={onLinkLogin} />
              )}
              <Qualifications
                employee={detail.data}
                services={services}
                serviceName={serviceName}
                busy={busy}
                onSave={onSaveServices}
              />
              <WeeklyHours
                hours={hours?.data ?? null}
                loading={hours?.initial ?? false}
                error={hours?.error ?? null}
                busy={busy}
                onSave={onSaveHours}
              />
            </>
          ) : null}
        </div>
      )}

      <div className="-mx-5 -mb-5 mt-5 flex items-center gap-1 border-t border-border/70 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex flex-1 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {open ? "Hide details" : "Show details"}
          <ChevronDown
            className={cn("size-3.5 shrink-0 transition-transform duration-200", open && "rotate-180")}
          />
        </button>
        <button
          type="button"
          onClick={onToggleActive}
          disabled={busy}
          title={
            person.isActive
              ? "Retire this stylist: they leave the roster and the booking engine, and their history is kept."
              : "Put this stylist back on the roster and the booking engine."
          }
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1.5 text-[11.5px] font-medium transition-colors disabled:opacity-50",
            person.isActive ? "text-clay hover:bg-clay/10" : "text-primary hover:bg-primary/[0.06]",
          )}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : person.isActive ? (
            "Deactivate"
          ) : (
            "Reactivate"
          )}
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ *
 * Link a login
 * ------------------------------------------------------------------ */

/**
 * Attach an existing sign-in account to this roster row.
 *
 * A record without a login is a normal thing - a stylist who does not use the
 * console - so this is offered, not demanded. It is also the only repair for
 * the accounts created before the invite linked the two: those people can sign
 * in, and their run sheet says they have no chair.
 *
 * Only logins with no roster row are offered, so the list cannot be used to
 * steal an account from someone else's card.
 */
function LinkLogin({
  logins,
  busy,
  onLink,
}: {
  logins: StaffLogin[];
  busy: boolean;
  onLink: (profileId: string) => Promise<boolean>;
}) {
  const [choice, setChoice] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function submit() {
    if (!choice) return;
    setSaving(true);
    const ok = await onLink(choice);
    setSaving(false);
    if (ok) setChoice("");
  }

  const disabled = busy || saving;

  return (
    <div className="mb-4 rounded-lg border border-dashed border-border/80 px-3 py-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Sign-in account
      </p>

      {logins.length === 0 ? (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          No login is linked to this record, and no unlinked employee logins are
          waiting. Issue one above to give them a way in.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            No login is linked to this record. Attach one of the accounts that
            has no roster row:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor={`login-${logins[0].id}`} className="sr-only">
              Sign-in account to link
            </label>
            <select
              id={`login-${logins[0].id}`}
              value={choice}
              disabled={disabled}
              onChange={(event) => setChoice(event.target.value)}
              className="h-9 max-w-[260px] rounded-lg border border-border bg-card px-2.5 text-[12.5px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            >
              <option value="">Choose a login…</option>
              {logins.map((login) => (
                <option key={login.id} value={login.id}>
                  {login.fullName ?? login.email ?? login.id}
                  {login.email && login.fullName ? ` — ${login.email}` : ""}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={!choice || disabled}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
              Link
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Qualifications
 * ------------------------------------------------------------------ */

/**
 * What a stylist may be booked for.
 *
 * The booking engine reads this set before it offers a slot, so an empty one
 * is not a detail: it is the difference between a name on the roster and a
 * person who can actually be assigned. That is why the empty state says so
 * plainly rather than showing nothing.
 *
 * The set is replaced, not patched - Save sends every id on screen - and the
 * editor stays open when the write fails, so the admin can correct the draft
 * instead of starting again.
 */
function Qualifications({
  employee,
  services,
  serviceName,
  busy,
  onSave,
}: {
  employee: Employee;
  services: Service[];
  serviceName: (id: string) => string;
  busy: boolean;
  onSave: (serviceIds: string[]) => Promise<boolean>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>(employee.serviceIds ?? []);

  /*
   * The card is not remounted when it is collapsed and reopened, so the draft
   * has to follow the record it belongs to. Keyed on the id alone: a reload
   * after a save returns a new object for the same person, and resetting on
   * that would wipe a draft mid-edit.
   */
  React.useEffect(() => {
    setSelected(employee.serviceIds ?? []);
    setEditing(false);
  }, [employee.id]);

  const offered = services
    .filter((service) => service.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (await onSave(selected)) setEditing(false);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Qualified for
        </p>
        {!editing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11.5px]"
            onClick={() => {
              setSelected(employee.serviceIds ?? []);
              setEditing(true);
            }}
          >
            <Pencil className="size-3" />
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <>
          <div className="mt-2 flex max-h-52 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-border/70 bg-card p-2.5">
            {offered.length === 0 ? (
              <p className="px-1 py-0.5 text-[11.5px] text-muted-foreground">
                No treatments are on the menu yet.
              </p>
            ) : (
              offered.map((service) => {
                const on = selected.includes(service.id);
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => toggle(service.id)}
                    aria-pressed={on}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {service.name}
                  </button>
                );
              })
            )}
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {selected.length === 0
              ? "Nothing selected — this stylist will not be offered for any treatment."
              : `${selected.length} treatment${selected.length === 1 ? "" : "s"} — the booking engine only offers them for these.`}
          </p>

          <div className="mt-3 flex items-center gap-1.5">
            <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <Badge key={id} variant="outline">
              {serviceName(id)}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-muted-foreground">
          No qualifications recorded — this stylist cannot be booked for anything
          yet. Use Edit to say what they can do.
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The weekly rota
 * ------------------------------------------------------------------ */

/**
 * The week as seven days of windows, Monday first.
 *
 * The column is `weekday` 0-6 with Sunday at 0 (that is what
 * `extract(dow …)` in `get_available_slots` returns), so the mapping lives
 * here once instead of at every use.
 *
 * A day can hold more than one window, because a split shift is a normal
 * salon pattern rather than an edge case. The editor has to keep them all:
 * the write is a replace, so showing only the first window would delete the
 * second one on save.
 */
const WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
] as const;

type Window = { startTime: string; endTime: string };
type Week = Record<number, Window[]>;
type HoursInput = { weekday: number; startTime: string; endTime: string }[];

function emptyWeek(): Week {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

function weekFrom(hours: WorkingHour[]): Week {
  const week = emptyWeek();
  for (const hour of hours) {
    week[hour.weekday] = [
      ...(week[hour.weekday] ?? []),
      { startTime: hour.startTime, endTime: hour.endTime },
    ];
  }
  return week;
}

/** "HH:MM" -> minutes, for comparisons that do not care about midnight. */
function minutesOf(hhmm: string): number {
  const [hours, mins] = hhmm.split(":").map(Number);
  return hours * 60 + mins;
}

function weekMinutes(week: Week): number {
  return Object.values(week)
    .flat()
    .reduce((total, window) => total + Math.max(0, minutesOf(window.endTime) - minutesOf(window.startTime)), 0);
}

function hoursLabel(mins: number): string {
  const hours = mins / 60;
  return (Number.isInteger(hours) ? String(hours) : hours.toFixed(1)) + " h";
}

/**
 * What would be wrong with this draft, in the order the server would say it.
 *
 * The overlap check is pairwise rather than "sort, then compare neighbours":
 * a window added at the top of a day is not sorted, and the two must give the
 * same answer. The server checks the same thing again - this is so the button
 * can be disabled before the round trip, not instead of it.
 */
function weekProblem(week: Week): string | null {
  const windows = Object.values(week).flat();
  if (windows.length === 0) {
    return "Add at least one window — with none, the booking engine offers this stylist nowhere.";
  }
  if (windows.length > 21) {
    return "At most 21 windows a week. That is the server's limit.";
  }
  for (const day of WEEKDAYS) {
    const list = week[day.value] ?? [];
    for (const window of list) {
      if (minutesOf(window.endTime) <= minutesOf(window.startTime)) {
        return day.long + ": the end time has to be after the start.";
      }
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (
          minutesOf(list[i].startTime) < minutesOf(list[j].endTime) &&
          minutesOf(list[j].startTime) < minutesOf(list[i].endTime)
        ) {
          return day.long + ": two windows overlap.";
        }
      }
    }
  }
  return null;
}

/**
 * The week the booking engine reads.
 *
 * Read view: seven lines, closed days muted, and the weekly total — which is
 * the honest answer to "what does this pattern cost me in bookable time".
 * Edit view: the same seven lines as inputs. Saving replaces the whole week,
 * so the draft starts from every stored window, split shifts included.
 *
 * The two views word the total differently on purpose, and that is not drift
 * to be tidied up: the read view says "22 h a week. Slots are only offered
 * inside these windows; a closed day has none." The edit view says "22 h a
 * week across 4 days", because while you are moving windows the day count is
 * the thing you are changing. A verification run once asserted the read view
 * used the edit view's sentence and reported a false failure; the copy was
 * right. Do not "fix" one to match the other.
 */
function WeeklyHours({
  hours,
  loading,
  error,
  busy,
  onSave,
}: {
  hours: WorkingHour[] | null;
  loading: boolean;
  error: ApiError | null;
  busy: boolean;
  onSave: (windows: HoursInput) => Promise<boolean>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [draft, setDraft] = React.useState<Week>(emptyWeek);

  const stored = React.useMemo(() => weekFrom(hours ?? []), [hours]);

  /*
   * Same reason as Qualifications: the card is not remounted between people,
   * so the draft follows the record. Keyed on the fetched week, which is a new
   * array after every save - so a save closes the editor instead of leaving a
   * draft that no longer matches what the server holds.
   */
  React.useEffect(() => {
    setDraft(stored);
    setEditing(false);
  }, [stored]);

  function setWindow(weekday: number, index: number, patch: Partial<Window>) {
    setDraft((prev) => ({
      ...prev,
      [weekday]: prev[weekday].map((window, i) => (i === index ? { ...window, ...patch } : window)),
    }));
  }

  function addWindow(weekday: number) {
    setDraft((prev) => ({
      ...prev,
      [weekday]: [...prev[weekday], { startTime: "09:00", endTime: "18:00" }],
    }));
  }

  function removeWindow(weekday: number, index: number) {
    setDraft((prev) => ({
      ...prev,
      [weekday]: prev[weekday].filter((_, i) => i !== index),
    }));
  }

  const problem = weekProblem(draft);
  const draftMinutes = weekMinutes(draft);
  const draftDays = WEEKDAYS.filter((day) => (draft[day.value] ?? []).length > 0).length;
  const storedMinutes = weekMinutes(stored);

  async function save() {
    if (problem) return;
    setSaving(true);
    const windows: HoursInput = WEEKDAYS.flatMap((day) =>
      (draft[day.value] ?? []).map((window) => ({ weekday: day.value, ...window })),
    );
    const ok = await onSave(windows);
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <div className="mt-5 border-t border-border/60 pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Weekly hours
        </p>
        {!editing && !loading && !error && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11.5px]"
            onClick={() => {
              // A cancelled draft must not reappear as the next one.
              setDraft(stored);
              setEditing(true);
            }}
          >
            <Pencil className="size-3" />
            Edit
          </Button>
        )}
      </div>

      {loading ? (
        <Loading label="Reading the rota…" className="py-4" />
      ) : error ? (
        <ErrorNote error={error} className="mt-2" />
      ) : editing ? (
        <>
          <div className="mt-2 space-y-1">
            {WEEKDAYS.map((day) => {
              const list = draft[day.value] ?? [];
              return (
                <div key={day.value} className="flex items-start gap-2">
                  <span className="mt-1.5 w-8 shrink-0 text-[11px] font-medium text-muted-foreground">
                    {day.short}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    {list.length === 0 ? (
                      <p className="py-1.5 text-[11.5px] text-muted-foreground">Closed</p>
                    ) : (
                      list.map((window, index) => (
                        <div key={index} className="flex items-center gap-1">
                          <input
                            type="time"
                            aria-label={day.long + " start"}
                            value={window.startTime}
                            onChange={(event) =>
                              event.target.value &&
                              setWindow(day.value, index, { startTime: event.target.value })
                            }
                            className="h-8 w-[94px] rounded-lg border border-border bg-card px-1.5 text-[12px] tabular-nums outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                          />
                          <span className="text-[11px] text-muted-foreground">–</span>
                          <input
                            type="time"
                            aria-label={day.long + " end"}
                            value={window.endTime}
                            onChange={(event) =>
                              event.target.value &&
                              setWindow(day.value, index, { endTime: event.target.value })
                            }
                            className="h-8 w-[94px] rounded-lg border border-border bg-card px-1.5 text-[12px] tabular-nums outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                          />
                          <button
                            type="button"
                            aria-label={"Remove the " + day.long + " window " + (index + 1)}
                            onClick={() => removeWindow(day.value, index)}
                            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-clay/10 hover:text-clay"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={"Add a window on " + day.long}
                    onClick={() => addWindow(day.value)}
                    disabled={Object.values(draft).flat().length >= 21}
                    className="mt-0.5 shrink-0 rounded-md border border-border p-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <p
            className={cn(
              "mt-2 text-[11px] leading-relaxed",
              problem ? "text-clay" : "text-muted-foreground",
            )}
          >
            {problem ??
              hoursLabel(draftMinutes) +
                " a week across " +
                draftDays +
                (draftDays === 1 ? " day" : " days") +
                ". Slots are only offered inside these windows."}
          </p>

          <div className="mt-3 flex items-center gap-1.5">
            <Button type="button" size="sm" disabled={busy || saving || !!problem} onClick={() => void save()}>
              {busy || saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy || saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="mt-2 overflow-hidden rounded-lg border border-border/70">
            {WEEKDAYS.map((day, index) => {
              const list = stored[day.value] ?? [];
              return (
                <div
                  key={day.value}
                  className={cn(
                    "flex items-baseline gap-3 px-2.5 py-[5px] text-[11.5px]",
                    index > 0 && "border-t border-border/50",
                  )}
                >
                  <span className="w-8 shrink-0 font-medium text-muted-foreground">{day.short}</span>
                  <span
                    className={cn("tabular-nums", list.length === 0 && "text-muted-foreground")}
                  >
                    {list.length === 0
                      ? "Closed"
                      : list.map((window) => window.startTime + "–" + window.endTime).join(", ")}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {storedMinutes === 0
              ? "No windows at all — the booking engine offers this stylist nowhere."
              : hoursLabel(storedMinutes) +
                " a week. Slots are only offered inside these windows; a closed day has none."}
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Issue a staff login
 * ------------------------------------------------------------------ */

function InviteStaffForm({
  services,
  onDone,
  onCancel,
}: {
  services: Service[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [title, setTitle] = React.useState("");
  /*
   * Asked here, not afterwards.
   *
   * The booking engine only offers a stylist who is qualified for the service,
   * and the roster row is created in the same request as the login - so a
   * stylist created without this list exists but is invisible to every
   * service-filtered list and to the booking grid until someone opens their
   * card and presses Edit.
   */
  const [serviceIds, setServiceIds] = React.useState<string[]>([]);
  const [role, setRole] = React.useState<"EMPLOYEE" | "CONCIERGE" | "ADMIN">("EMPLOYEE");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [localErrors, setLocalErrors] = React.useState<Record<string, string>>({});
  const [created, setCreated] = React.useState<{
    email: string;
    employeeId?: string;
    qualified: number;
  } | null>(null);

  const toggleService = (id: string) =>
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!fullName.trim()) next.fullName = "A name is required";
    // Checked here as well as on the server: a blank or malformed address came
    // back as a validation error about a field the form had let through.
    if (!email.trim()) next.email = "An email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.email = "That does not look like an email address";
    if (password.length < 8) next.password = "At least 8 characters";
    if (password.length > 72) next.password = "At most 72 characters";
    setLocalErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setError(null);
    try {
      const account = await api.admin.createStaff({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        role,
        title: role === "EMPLOYEE" ? title.trim() || undefined : undefined,
        serviceIds: role === "EMPLOYEE" ? serviceIds : [],
      });
      setCreated({
        email: account.email ?? email.trim(),
        employeeId: account.employeeId,
        qualified: role === "EMPLOYEE" ? serviceIds.length : 0,
      });
      setFullName("");
      setEmail("");
      setPassword("");
      setTitle("");
      setServiceIds([]);
      // The roster is behind this form and has just changed; reload it now
      // rather than leaving the admin to wonder why the new name is not there.
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not create the account"));
    } finally {
      setBusy(false);
    }
  }

  const fieldErrors = { ...error?.fieldErrors, ...localErrors };

  return (
    <form onSubmit={submit} className="rounded-xl border border-primary/25 bg-primary/[0.03] p-6" noValidate>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-[19px] font-semibold tracking-tight">
            Issue a team login
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            The role is written to the account's app metadata by the server — the
            person cannot promote themselves later.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="size-4" />
          Close
        </Button>
      </div>

      {created && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-alley-200 bg-alley-50 px-4 py-3">
          <BadgeCheck className="mt-0.5 size-4 shrink-0 text-alley-700" />
          <p className="text-[12.5px] text-alley-700">
            <span className="font-medium">{created.email}</span> now has a{" "}
            {ROLE_LABEL[role].toLowerCase()} account.{" "}
            {!created.employeeId
              ? "No employee row is needed — front desk staff work reception, not the floor."
              : created.qualified > 0
                ? `They are on the roster, qualified for ${created.qualified} treatment${created.qualified === 1 ? "" : "s"} — the booking engine can offer them now.`
                : "They are on the roster below — add their qualifications so the booking engine can offer them."}
          </p>
        </div>
      )}

      {error && <ErrorNote error={error} className="mt-4" />}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Ana Reyes"
          error={fieldErrors.fullName}
        />
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ana@beautyalley.ph"
          error={fieldErrors.email}
        />
        <TextField
          label="Temporary password"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="at least 8 characters"
          error={fieldErrors.password}
        />
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Role
          </span>
          <div className="mt-1.5 flex gap-1.5">
            {(["EMPLOYEE", "CONCIERGE", "ADMIN"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setRole(option);
                  // Qualifications belong to a roster row; a concierge has none.
                  if (option !== "EMPLOYEE") setServiceIds([]);
                }}
                aria-pressed={role === option}
                className={cn(
                  "h-10 flex-1 rounded-lg border text-[12.5px] font-medium transition-colors",
                  role === option
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/30",
                )}
              >
                {ROLE_LABEL[option]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {role === "EMPLOYEE" && (
        <>
          <div className="mt-4 max-w-[320px]">
            <TextField
              label="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Senior therapist"
              error={fieldErrors.title}
            />
          </div>

          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Qualified for
            </p>
            <div className="mt-1.5 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-border/70 bg-card p-2.5">
              {services.length === 0 ? (
                <p className="px-1 py-0.5 text-[11.5px] text-muted-foreground">
                  No treatments are on the menu yet.
                </p>
              ) : (
                services.map((service) => {
                  const on = serviceIds.includes(service.id);
                  return (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => toggleService(service.id)}
                      aria-pressed={on}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40",
                      )}
                    >
                      {service.name}
                    </button>
                  );
                })
              )}
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              The booking engine only offers a stylist who is qualified for the
              chosen treatment. Leave this empty and they stay on the roster,
              unbookable, until someone edits their card.
            </p>
          </div>
        </>
      )}

      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creating…
            </>
          ) : (
            <>
              <UserPlus className="size-4" />
              Create account
            </>
          )}
        </Button>
        <p className="text-[12px] text-muted-foreground">
          They can sign in immediately at{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            the sign-in page
          </Link>
          .
        </p>
      </div>
    </form>
  );
}
