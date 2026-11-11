"use client";

/**
 * Settings — one page, grouped by who is allowed to do what.
 *
 *   My account        every role: change your own password
 *   Account recovery  ADMIN: set any account's password by email
 *   Booking rules     ADMIN: the cancellation cutoff and arrival window
 *   Door screens      ADMIN: issue and switch off the tablets by the doors
 *   Payments          ADMIN: which providers are offered at the desk
 *
 * The password forms are the reason this page exists: the owner should not
 * need the Supabase dashboard to give a stylist a new password, and a member
 * of staff should not need to ask the owner to change their own.
 *
 * Both password paths go through the API, never through the browser's Supabase
 * client. The service role key stays on the server; the page only ever holds a
 * session token.
 */

import * as React from "react";
import {
  CalendarClock,
  CheckCircle2,
  Copy,
  Eye,
  Mail,
  EyeOff,
  KeyRound,
  Loader2,
  MonitorSmartphone,
  Power,
  Save,
  Settings2,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import type {
  DepositCancelRule,
  KioskDevice,
  PaymentProviderId,
  PaymentProviderOption,
} from "@/lib/api-types";
import { useAsync } from "@/lib/useAsync";
import { useAuth, ROLE_LABEL } from "@/auth/AuthProvider";
import { cn, relativeToNow, shortDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Panel, SectionHeading } from "@/components/app/bits";
import { ErrorNote, Loading, TextField } from "@/components/app/api-bits";

/* ------------------------------------------------------------------ *
 * Small pieces
 * ------------------------------------------------------------------ */

function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-alley-200 bg-alley-50 px-3.5 py-2.5 text-[12.5px] text-alley-700">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: string;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <TextField
        label={label}
        hint={hint}
        type={visible ? "text" : "password"}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        style={{ paddingRight: 36 }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-2 top-[30px] rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200",
        checked
          ? "border-primary/30 bg-primary"
          : "border-border bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function Settings() {
  const { me, role, isAdmin } = useAuth();

  /* --- my password ------------------------------------------------- */
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [pwBusy, setPwBusy] = React.useState(false);
  const [pwError, setPwError] = React.useState<string | null>(null);
  const [pwDone, setPwDone] = React.useState(false);

  async function changeOwnPassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwDone(false);

    if (next.length < 8) return setPwError("The new password must be at least 8 characters.");
    if (next !== confirm) return setPwError("The two new passwords do not match.");
    if (next === current) return setPwError("The new password must be different from the current one.");

    setPwBusy(true);
    try {
      await api.auth.changePassword(current, next);
      setPwDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : "Could not change the password.");
    } finally {
      setPwBusy(false);
    }
  }

  /* --- admin reset -------------------------------------------------- */
  const [targetEmail, setTargetEmail] = React.useState("");
  const [resetPassword, setResetPassword] = React.useState("");
  const [resetConfirm, setResetConfirm] = React.useState("");
  const [resetBusy, setResetBusy] = React.useState(false);
  const [resetError, setResetError] = React.useState<string | null>(null);
  const [resetDone, setResetDone] = React.useState<string | null>(null);

  async function adminReset(e: React.FormEvent) {
    e.preventDefault();
    setResetError(null);
    setResetDone(null);

    if (!/^\S+@\S+\.\S+$/.test(targetEmail.trim())) return setResetError("Enter the account's email address.");
    if (resetPassword.length < 8) return setResetError("The new password must be at least 8 characters.");
    if (resetPassword !== resetConfirm) return setResetError("The two passwords do not match.");

    setResetBusy(true);
    try {
      const result = await api.admin.resetUserPassword(targetEmail.trim().toLowerCase(), resetPassword);
      setResetDone(result.email ?? targetEmail.trim().toLowerCase());
      setResetPassword("");
      setResetConfirm("");
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : "Could not reset that password.");
    } finally {
      setResetBusy(false);
    }
  }

  /* --- payments ----------------------------------------------------- */
  const payments = useAsync("settings:payments", () => api.settings.payments());
  const [options, setOptions] = React.useState<PaymentProviderOption[] | null>(null);
  const [defaultProvider, setDefaultProvider] = React.useState<PaymentProviderId>("cash");
  const [payBusy, setPayBusy] = React.useState(false);
  const [payError, setPayError] = React.useState<string | null>(null);
  const [payDone, setPayDone] = React.useState(false);

  React.useEffect(() => {
    if (!payments.data) return;
    setOptions(payments.data.options);
    setDefaultProvider(payments.data.default);
  }, [payments.data]);

  function toggleProvider(id: PaymentProviderId) {
    setPayDone(false);
    setOptions((current) => {
      if (!current) return current;
      const nextOptions = current.map((o) => (o.id === id ? { ...o, enabled: !o.enabled } : o));
      // If the default was just switched off, promote the first remaining
      // provider rather than letting the form submit an invalid combination.
      if (id === defaultProvider && !nextOptions.find((o) => o.id === id)?.enabled) {
        const firstEnabled = nextOptions.find((o) => o.enabled);
        if (firstEnabled) setDefaultProvider(firstEnabled.id);
      }
      return nextOptions;
    });
  }

  async function savePayments() {
    if (!options) return;
    setPayError(null);
    setPayDone(false);
    setPayBusy(true);
    try {
      const saved = await api.settings.updatePayments({
        default: defaultProvider,
        options: options.map((o) => ({ id: o.id, enabled: o.enabled })),
      });
      setOptions(saved.options);
      setDefaultProvider(saved.default);
      setPayDone(true);
      payments.reload();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : "Could not save the payment settings.");
    } finally {
      setPayBusy(false);
    }
  }

  /* --- booking rules ------------------------------------------------ */
  const booking = useAsync("settings:booking", () => api.settings.booking());
  const [cancelHours, setCancelHours] = React.useState("2");
  const [arrivalMinutes, setArrivalMinutes] = React.useState("60");
  const [bookBusy, setBookBusy] = React.useState(false);
  const [bookError, setBookError] = React.useState<string | null>(null);
  const [bookDone, setBookDone] = React.useState(false);

  React.useEffect(() => {
    if (!booking.data) return;
    setCancelHours(String(booking.data.cancellationWindowHours));
    setArrivalMinutes(String(booking.data.arrivalWindowMinutes));
  }, [booking.data]);

  async function saveBooking() {
    setBookError(null);
    setBookDone(false);

    const hours = Number(cancelHours);
    const minutes = Number(arrivalMinutes);
    if (!Number.isInteger(hours) || hours < 0 || hours > 72) {
      return setBookError("Cancellation cutoff must be a whole number from 0 to 72 hours.");
    }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) {
      return setBookError("Arrival window must be a whole number from 0 to 240 minutes.");
    }

    setBookBusy(true);
    try {
      await api.settings.updateBooking({
        cancellationWindowHours: hours,
        arrivalWindowMinutes: minutes,
      });
      setBookDone(true);
      booking.reload();
    } catch (err) {
      setBookError(err instanceof ApiError ? err.message : "Could not save the booking rules.");
    } finally {
      setBookBusy(false);
    }
  }

  /* --- deposit policy ----------------------------------------------- */
  const depositPolicy = useAsync("settings:deposit-policy", () => api.settings.deposits());
  const [policyEnabled, setPolicyEnabled] = React.useState(false);
  const [policyAmount, setPolicyAmount] = React.useState("500");
  const [policyOnCancel, setPolicyOnCancel] = React.useState<DepositCancelRule>("refund");
  const [policyBusy, setPolicyBusy] = React.useState(false);
  const [policyError, setPolicyError] = React.useState<string | null>(null);
  const [policyDone, setPolicyDone] = React.useState(false);

  React.useEffect(() => {
    if (!depositPolicy.data) return;
    setPolicyEnabled(depositPolicy.data.enabled);
    setPolicyAmount(String(depositPolicy.data.amountCents / 100));
    setPolicyOnCancel(depositPolicy.data.onCancel);
  }, [depositPolicy.data]);

  async function saveDepositPolicy() {
    setPolicyError(null);
    setPolicyDone(false);
    const pesos = Number(policyAmount);
    if (!Number.isFinite(pesos) || pesos < 1 || pesos > 10000) {
      return setPolicyError("Enter an amount between ₱1 and ₱10,000.");
    }
    setPolicyBusy(true);
    try {
      await api.settings.updateDeposits({
        enabled: policyEnabled,
        amountCents: Math.round(pesos * 100),
        onCancel: policyOnCancel,
      });
      setPolicyDone(true);
      depositPolicy.reload();
    } catch (err) {
      setPolicyError(err instanceof ApiError ? err.message : "Could not save the deposit policy.");
    } finally {
      setPolicyBusy(false);
    }
  }

  /* --- reminders ---------------------------------------------------- */
  const reminders = useAsync("settings:reminders", () => api.settings.reminders());
  const [mailBusy, setMailBusy] = React.useState(false);
  const [mailInfo, setMailInfo] = React.useState<string | null>(null);
  const [mailError, setMailError] = React.useState<string | null>(null);

  async function sendTestEmail() {
    setMailBusy(true);
    setMailInfo(null);
    setMailError(null);
    try {
      const result = await api.settings.testReminder();
      setMailInfo(`Test email sent to ${result.to}.`);
    } catch (err) {
      setMailError(err instanceof ApiError ? err.message : "Could not send the test email.");
    } finally {
      setMailBusy(false);
    }
  }

  const enabledCount = options?.filter((o) => o.enabled).length ?? 0;

  /* --- deposit test ------------------------------------------------- */
  const [depositAmount, setDepositAmount] = React.useState("500");
  const [depositBusy, setDepositBusy] = React.useState(false);
  const [depositError, setDepositError] = React.useState<string | null>(null);
  const [depositInfo, setDepositInfo] = React.useState<string | null>(null);

  async function openDepositCheckout() {
    setDepositError(null);
    setDepositInfo(null);
    const pesos = Number(depositAmount);
    if (!Number.isFinite(pesos) || pesos < 1 || pesos > 10000) {
      return setDepositError("Enter an amount between ₱1 and ₱10,000.");
    }
    setDepositBusy(true);
    try {
      const checkout = await api.deposits.testCheckout({ amountCents: Math.round(pesos * 100) });
      window.open(checkout.checkoutUrl, "_blank", "noopener,noreferrer");
      setDepositInfo(
        checkout.mode === "mock"
          ? `Mock checkout opened (${checkout.reference}). No money moves; HitPay is not configured.`
          : `HitPay ${checkout.mode} checkout opened (${checkout.reference}).`,
      );
    } catch (err) {
      setDepositError(err instanceof ApiError ? err.message : "Could not open the checkout.");
    } finally {
      setDepositBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Your sign-in and the choices that change how the desk works. Password changes take effect immediately."
        icon={Settings2}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ------------------------------------------------ my account */}
        <Panel className="p-5 sm:p-6">
          <SectionHeading
            eyebrow="Everyone"
            title="My account"
            description="Change the password you use to sign in."
          />

          <div className="mt-4 rounded-lg border border-border/70 bg-muted/30 px-3.5 py-3">
            <p className="text-[13px] font-semibold">{me?.fullName || "Signed in"}</p>
            <p className="text-[11.5px] text-muted-foreground">
              {me?.email} · {role ? ROLE_LABEL[role] : "—"}
            </p>
          </div>

          <form onSubmit={changeOwnPassword} className="mt-4 space-y-3.5">
            <PasswordField
              label="Current password"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
            />
            <PasswordField
              label="New password"
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              hint="At least 8 characters."
            />
            <PasswordField
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
            />

            {pwError && (
              <p className="rounded-lg border border-clay/25 bg-clay/[0.04] px-3 py-2 text-[12px] text-clay">
                {pwError}
              </p>
            )}
            {pwDone && <SuccessNote>Password changed. Use the new one next time you sign in.</SuccessNote>}

            <Button type="submit" disabled={pwBusy || !current || !next || !confirm}>
              {pwBusy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              {pwBusy ? "Changing…" : "Change password"}
            </Button>
          </form>
        </Panel>

        {/* ------------------------------------------- admin recovery */}
        <Panel className="p-5 sm:p-6">
          <SectionHeading
            eyebrow="Owner"
            title="Account recovery"
            description="Set a new password for any account, by email. No reset link is sent."
          />

          {!isAdmin ? (
            <div className="mt-6 flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 px-4 py-4">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                Only the owner can reset another account's password. Ask them if someone on your
                team is locked out.
              </p>
            </div>
          ) : (
            <form onSubmit={adminReset} className="mt-4 space-y-3.5">
              <TextField
                label="Account email"
                type="email"
                placeholder="stylist@beautyalley.ph"
                value={targetEmail}
                autoComplete="off"
                onChange={(e) => setTargetEmail(e.target.value)}
              />
              <PasswordField
                label="New password"
                value={resetPassword}
                onChange={setResetPassword}
                autoComplete="new-password"
                hint="At least 8 characters."
              />
              <PasswordField
                label="Confirm new password"
                value={resetConfirm}
                onChange={setResetConfirm}
                autoComplete="new-password"
              />

              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                This takes effect immediately. The person's existing sessions stay signed in until
                they expire, so ask them to sign out and back in.
              </p>

              {resetError && (
                <p className="rounded-lg border border-clay/25 bg-clay/[0.04] px-3 py-2 text-[12px] text-clay">
                  {resetError}
                </p>
              )}
              {resetDone && <SuccessNote>Password updated for {resetDone}.</SuccessNote>}

              <Button type="submit" disabled={resetBusy || !targetEmail || !resetPassword || !resetConfirm}>
                {resetBusy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                {resetBusy ? "Updating…" : "Set password"}
              </Button>
            </form>
          )}
        </Panel>
      </div>

      {/* ------------------------------------------------ booking rules */}
      <Panel className="p-5 sm:p-6">
        <SectionHeading
          eyebrow="Owner"
          title="Booking rules"
          description="Two policies the desk applies every day. Changes take effect on the next cancellation or pass — no redeploy."
          action={
            isAdmin && booking.data ? (
              <Button onClick={saveBooking} disabled={bookBusy}>
                {bookBusy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {bookBusy ? "Saving…" : "Save"}
              </Button>
            ) : undefined
          }
        />

        {!isAdmin ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 px-4 py-4">
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Booking policy is business configuration, so only the owner can change it. Ask them if
              the cancellation cutoff or arrival window needs adjusting.
            </p>
          </div>
        ) : booking.loading && !booking.data ? (
          <Loading label="Loading booking rules…" />
        ) : booking.error ? (
          <ErrorNote error={booking.error} onRetry={booking.reload} />
        ) : (
          <div className="mt-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Cancellation cutoff (hours)"
                type="number"
                min={0}
                max={72}
                value={cancelHours}
                onChange={(e) => {
                  setCancelHours(e.target.value);
                  setBookDone(false);
                }}
                hint="A client may cancel up to this many hours before the appointment. Staff can always override."
              />
              <TextField
                label="Arrival window (minutes)"
                type="number"
                min={0}
                max={240}
                value={arrivalMinutes}
                onChange={(e) => {
                  setArrivalMinutes(e.target.value);
                  setBookDone(false);
                }}
                hint="How early a guest's pass opens before the appointment. The desk can still admit early."
              />
            </div>

            <p className="text-[11.5px] text-muted-foreground">
              Current: cancel up to {booking.data?.cancellationWindowHours ?? 2} hours before; pass
              opens {booking.data?.arrivalWindowMinutes ?? 60} minutes early.
              {booking.data?.updatedAt
                ? ` Last updated ${new Date(booking.data.updatedAt).toLocaleString()}.`
                : ""}
            </p>

            {bookError && (
              <p className="rounded-lg border border-clay/25 bg-clay/[0.04] px-3 py-2 text-[12px] text-clay">
                {bookError}
              </p>
            )}
            {bookDone && <SuccessNote>Booking rules saved. The next cancellation and pass use them.</SuccessNote>}
          </div>
        )}
      </Panel>

      {/* ------------------------------------------------- door screens */}
      <DoorScreens isAdmin={isAdmin} />

      {/* ------------------------------------------------ deposit policy */}
      <Panel className="p-5 sm:p-6">
        <SectionHeading
          eyebrow="Owner"
          title="Deposit policy"
          description="While this is on, every new booking carries a deposit. The desk can mark it paid or waive it; an unpaid deposit blocks check-in."
          action={
            isAdmin && depositPolicy.data ? (
              <Button onClick={saveDepositPolicy} disabled={policyBusy}>
                {policyBusy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {policyBusy ? "Saving…" : "Save"}
              </Button>
            ) : undefined
          }
        />

        {!isAdmin ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 px-4 py-4">
            <Wallet className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Deposits are money policy, so only the owner can change them.
            </p>
          </div>
        ) : depositPolicy.loading && !depositPolicy.data ? (
          <Loading label="Loading the deposit policy…" />
        ) : depositPolicy.error ? (
          <ErrorNote error={depositPolicy.error} onRetry={depositPolicy.reload} />
        ) : (
          <div className="mt-5 space-y-4">
            <label className="flex items-start gap-3 rounded-lg border border-border/70 bg-card px-4 py-3">
              <input
                type="checkbox"
                checked={policyEnabled}
                onChange={(e) => {
                  setPolicyEnabled(e.target.checked);
                  setPolicyDone(false);
                }}
                className="mt-0.5 size-4 accent-[#1B4D3E]"
              />
              <span>
                <span className="block text-[13px] font-medium">Require a deposit at booking</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                  Off by default. Turning it on does not move money; it records an obligation the desk can settle.
                </span>
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Deposit amount (₱)"
                type="number"
                min={1}
                max={10000}
                value={policyAmount}
                onChange={(e) => {
                  setPolicyAmount(e.target.value);
                  setPolicyDone(false);
                }}
                hint="One to ten thousand pesos. The same amount applies to every booking."
              />
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  If a booking is cancelled
                </span>
                <select
                  value={policyOnCancel}
                  onChange={(e) => {
                    setPolicyOnCancel(e.target.value as DepositCancelRule);
                    setPolicyDone(false);
                  }}
                  className="mt-1.5 block h-10 w-full rounded-lg border border-border bg-card px-3 text-[13.5px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                >
                  <option value="refund">Refund the deposit</option>
                  <option value="forfeit_if_late">Keep it inside the cancellation window</option>
                  <option value="forfeit">Keep it</option>
                </select>
                <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                  A no-show always keeps the deposit. A staff-forced cancellation always refunds.
                </span>
              </label>
            </div>

            <p className="text-[11.5px] text-muted-foreground">
              Current: {depositPolicy.data?.enabled
                ? "₱" + (depositPolicy.data.amountCents / 100).toFixed(2) + " per booking"
                : "off"}.
            </p>

            {policyError && (
              <p className="rounded-lg border border-clay/25 bg-clay/[0.04] px-3 py-2 text-[12px] text-clay">
                {policyError}
              </p>
            )}
            {policyDone && <SuccessNote>Deposit policy saved. It applies to new bookings only.</SuccessNote>}
          </div>
        )}
      </Panel>

      {/* ---------------------------------------------------- deposits */}
      <Panel className="p-5 sm:p-6">
        <SectionHeading
          eyebrow="Owner"
          title="Deposits (test)"
          description="Open a deposit checkout to exercise the flow. Mock mode uses the built-in test gateway; a HitPay key opens HitPay's hosted page. Nothing here is attached to a booking."
        />

        {!isAdmin ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 px-4 py-4">
            <Wallet className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Deposit testing is owner-only. It spends the salon's HitPay account, even in sandbox
              mode.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <TextField
                  label="Amount (₱)"
                  type="number"
                  min={1}
                  max={10000}
                  value={depositAmount}
                  onChange={(e) => {
                    setDepositAmount(e.target.value);
                    setDepositInfo(null);
                  }}
                  hint="Between ₱1 and ₱10,000."
                />
              </div>
              <Button onClick={openDepositCheckout} disabled={depositBusy}>
                {depositBusy ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                {depositBusy ? "Opening…" : "Open HitPay checkout"}
              </Button>
            </div>

            {depositError && (
              <p className="rounded-lg border border-clay/25 bg-clay/[0.04] px-3 py-2 text-[12px] text-clay">
                {depositError}
              </p>
            )}
            {depositInfo && <SuccessNote>{depositInfo}</SuccessNote>}

            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Without a HitPay API key the button opens a built-in test checkout that settles through
              a signed webhook. With a sandbox or live key, the same call creates a real hosted
              checkout for the methods enabled on the account. Nothing is written to a booking in
              either mode.
            </p>
          </div>
        )}
      </Panel>

      {/* ---------------------------------------------------- reminders */}
      <Panel className="p-5 sm:p-6">
        <SectionHeading
          eyebrow="Owner"
          title="Reminders"
          description="A 24-hour and a 2-hour email are queued for every booking. The scheduled job sends whatever is due."
        />

        {!isAdmin ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 px-4 py-4">
            <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Reminder delivery is owner-only configuration.
            </p>
          </div>
        ) : reminders.initial && !reminders.data ? (
          <Loading label="Reading the reminder queue…" />
        ) : reminders.error ? (
          <ErrorNote error={reminders.error} onRetry={reminders.reload} />
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={reminders.data?.configured ? "success" : "destructive"}>
                {reminders.data?.configured ? "SMTP connected" : "SMTP not configured"}
              </Badge>
              <span className="text-[12px] text-muted-foreground">
                The scheduled sender runs every hour.
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Queued", value: reminders.data?.queued ?? 0 },
                { label: "Sent", value: reminders.data?.sent ?? 0 },
                { label: "Failed", value: reminders.data?.failed ?? 0 },
                { label: "Skipped", value: reminders.data?.skipped ?? 0 },
              ].map((m) => (
                <div key={m.label} className="rounded-lg border border-border/70 bg-muted/20 px-3.5 py-3">
                  <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {m.label}
                  </dt>
                  <dd className="mt-1 font-display text-[20px] font-semibold">{m.value}</dd>
                </div>
              ))}
            </dl>

            <p className="text-[11.5px] text-muted-foreground">
              {reminders.data?.nextSendAt
                ? `Next reminder due ${new Date(reminders.data.nextSendAt).toLocaleString()}.`
                : "Nothing is queued right now."}
            </p>

            <Button
              onClick={sendTestEmail}
              disabled={!reminders.data?.configured || mailBusy}
            >
              {mailBusy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              {mailBusy ? "Sending…" : "Send a test email"}
            </Button>

            {mailError && (
              <p className="rounded-lg border border-clay/25 bg-clay/[0.04] px-3 py-2 text-[12px] text-clay">
                {mailError}
              </p>
            )}
            {mailInfo && <SuccessNote>{mailInfo}</SuccessNote>}
          </div>
        )}
      </Panel>

      {/* ---------------------------------------------------- payments */}
      <Panel className="p-5 sm:p-6">
        <SectionHeading
          eyebrow="Owner"
          title="Payments"
          description="Which payment methods the desk offers. This records the choice; it does not connect a processor."
          action={
            isAdmin && options ? (
              <Button onClick={savePayments} disabled={payBusy || enabledCount === 0}>
                {payBusy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {payBusy ? "Saving…" : "Save"}
              </Button>
            ) : undefined
          }
        />

        {!isAdmin ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 px-4 py-4">
            <Wallet className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Payment methods are business configuration, so only an administrator can change them.
            </p>
          </div>
        ) : payments.loading && !options ? (
          <Loading label="Loading payment methods…" />
        ) : payments.error ? (
          <ErrorNote error={payments.error} onRetry={payments.reload} />
        ) : options ? (
          <div className="mt-5 space-y-4">
            <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
              {options.map((provider) => (
                <div key={provider.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{provider.label}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {provider.enabled ? "Offered at the desk" : "Hidden"}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      <input
                        type="radio"
                        name="default-provider"
                        className="accent-[var(--color-primary)]"
                        checked={defaultProvider === provider.id}
                        disabled={!provider.enabled}
                        onChange={() => {
                          setDefaultProvider(provider.id);
                          setPayDone(false);
                        }}
                      />
                      Default
                    </label>
                    <Toggle
                      checked={provider.enabled}
                      onChange={() => toggleProvider(provider.id)}
                      label={`${provider.enabled ? "Disable" : "Enable"} ${provider.label}`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11.5px] text-muted-foreground">
              {enabledCount} of {options.length} methods offered. The default is preselected when a
              deposit flow is added.
              {payments.data?.updatedAt
                ? ` Last updated ${new Date(payments.data.updatedAt).toLocaleString()}.`
                : ""}
            </p>

            {payError && (
              <p className="rounded-lg border border-clay/25 bg-clay/[0.04] px-3 py-2 text-[12px] text-clay">
                {payError}
              </p>
            )}
            {payDone && <SuccessNote>Payment methods saved.</SuccessNote>}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Door screens
 * ------------------------------------------------------------------ */

/**
 * The tablet by the entrance, and the link that turns it into one.
 *
 * This is the only place in the product that displays a credential, so the
 * link is treated like one: it is shown once, it is copied rather than typed,
 * and losing it is fixed by switching the screen off and issuing another. The
 * API cannot show it again — it keeps a digest — and the panel says so rather
 * than leaving the owner to discover it.
 *
 * Revocation is inline rather than a dialog: the button is on the row it
 * affects, and the consequence ("stops admitting guests immediately") is the
 * sentence next to the confirmation, because that is the fact being decided.
 */
function DoorScreens({ isAdmin }: { isAdmin: boolean }) {
  // Not fetched for a non-owner: the endpoint is ADMIN, and a page that asks
  // and then apologises for the answer puts a 403 in every stylist's console.
  const screens = useAsync("settings:door-screens", () =>
    isAdmin ? api.doorScreens.list() : Promise.resolve([]),
  );

  const [label, setLabel] = React.useState("");
  const [issuing, setIssuing] = React.useState(false);
  const [issueError, setIssueError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<{ label: string; link: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const [revokeError, setRevokeError] = React.useState<string | null>(null);

  async function issue(event: React.FormEvent) {
    event.preventDefault();
    const name = label.trim();
    if (!name) return;

    setIssueError(null);
    setCopied(false);
    setIssuing(true);
    try {
      const result = await api.doorScreens.issue(name);
      // Assembled here, not on the server: the API does not know which origin
      // the tablet will be pointed at, and the origin the owner is reading this
      // on is the one they have just proved serves the app.
      setIssued({
        label: result.device.label,
        link: `${window.location.origin}/kiosk#t=${result.token}`,
      });
      setLabel("");
      screens.reload();
    } catch (err) {
      setIssueError(err instanceof ApiError ? err.message : "Could not issue a screen.");
    } finally {
      setIssuing(false);
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Refused on a non-HTTPS origin and on some managed browsers. The field
      // is selectable, so the fallback is the owner's own keyboard rather than
      // a second error they cannot act on.
      setCopied(false);
    }
  }

  async function revoke(device: KioskDevice) {
    setRevokeError(null);
    setRevoking(device.id);
    try {
      await api.doorScreens.revoke(device.id);
      setConfirming(null);
      screens.reload();
    } catch (err) {
      setRevokeError(err instanceof ApiError ? err.message : "Could not switch that screen off.");
    } finally {
      setRevoking(null);
    }
  }

  const devices = screens.data ?? [];
  const liveCount = devices.filter((d) => !d.revokedAt).length;

  return (
    <Panel className="p-5 sm:p-6">
      <SectionHeading
        eyebrow="Owner"
        title="Door screens"
        description="The tablet by the entrance. A screen admits a guest only after a stylist confirms with their door PIN, which is set on the Team page."
      />

      {!isAdmin ? (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 px-4 py-4">
          <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Issuing and switching off door screens is owner-only: each one holds a credential that
            admits guests.
          </p>
        </div>
      ) : screens.initial && !screens.data ? (
        <Loading label="Reading the door screens…" />
      ) : screens.error ? (
        <ErrorNote error={screens.error} onRetry={screens.reload} />
      ) : (
        <div className="mt-5 space-y-4">
          <form onSubmit={issue} className="flex flex-wrap items-end gap-3">
            <div className="min-w-52 flex-1">
              <TextField
                label="What to call it"
                placeholder="Front door"
                value={label}
                autoComplete="off"
                maxLength={60}
                onChange={(e) => {
                  setLabel(e.target.value);
                  setIssued(null);
                }}
                hint="Only you see this name. Two screens may share one."
              />
            </div>
            <Button type="submit" disabled={issuing || label.trim().length === 0}>
              {issuing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <MonitorSmartphone className="size-4" />
              )}
              {issuing ? "Issuing…" : "Issue a screen"}
            </Button>
          </form>

          {issueError && (
            <p className="rounded-lg border border-clay/25 bg-clay/[0.04] px-3 py-2 text-[12px] text-clay">
              {issueError}
            </p>
          )}

          {issued && (
            <div className="rounded-xl border border-champagne-400/50 bg-sand-50 p-4">
              <p className="text-[12.5px] font-semibold">
                Link for “{issued.label}”
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                Open it on the tablet, once. It is shown only now — the server keeps a hash of it,
                so it cannot be displayed again. If it is lost, switch the screen off and issue
                another.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  readOnly
                  value={issued.link}
                  aria-label="Door link"
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 font-mono text-[11.5px] text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                />
                <Button type="button" variant="outline" onClick={() => copy(issued.link)}>
                  <Copy className="size-4" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}

          {devices.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/80 px-4 py-6 text-center text-[12.5px] text-muted-foreground">
              No screen has been issued yet. The door still works from the Arrivals page.
            </p>
          ) : (
            <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                      <span className="truncate">{device.label}</span>
                      <Badge variant={device.revokedAt ? "secondary" : "success"}>
                        {device.revokedAt ? "Switched off" : "Live"}
                      </Badge>
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      Issued {shortDate(device.createdAt)} ·{" "}
                      {device.lastSeenAt
                        ? `last seen ${relativeToNow(device.lastSeenAt)}`
                        : "never connected"}
                    </p>
                  </div>

                  {!device.revokedAt &&
                    (confirming === device.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11.5px] text-muted-foreground">
                          It stops admitting guests immediately.
                        </span>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => revoke(device)}
                          disabled={revoking === device.id}
                        >
                          {revoking === device.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Power className="size-3.5" />
                          )}
                          {revoking === device.id ? "Switching off…" : "Switch off"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirming(null)}
                          disabled={revoking === device.id}
                        >
                          Keep it
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirming(device.id)}
                      >
                        <Power className="size-3.5" />
                        Switch off
                      </Button>
                    ))}
                </div>
              ))}
            </div>
          )}

          {revokeError && (
            <p className="rounded-lg border border-clay/25 bg-clay/[0.04] px-3 py-2 text-[12px] text-clay">
              {revokeError}
            </p>
          )}

          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            {liveCount === 0
              ? "No screen is live."
              : `${liveCount} ${liveCount === 1 ? "screen is" : "screens are"} live.`}{" "}
            A switched-off screen keeps its row so past admissions stay attributable to it.
          </p>
        </div>
      )}
    </Panel>
  );
}
