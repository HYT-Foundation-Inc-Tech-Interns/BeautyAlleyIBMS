"use client";

/**
 * "Make this client a login."
 *
 * The desk meets this at the counter: a regular has been booked as a guest for
 * a year, asks to see their own history, and reception should be able to
 * answer in the same minute. An administrator makes every other kind of
 * account; this is the one a concierge may make, and it creates nothing but a
 * CLIENT — the API has no role field here to get wrong.
 *
 * The password is set by the person at the desk and read to the guest, so it
 * is shown, not hidden behind dots they cannot check. There is no email in the
 * flow on purpose: the account is confirmed at creation, and a confirmation
 * link built from the project Site URL is exactly what used to land on
 * localhost.
 */

import * as React from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, UserPlus } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import type { CreatedClientAccount } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent } from "@/components/ui/modal";
import { ErrorNote, TextField } from "@/components/app/api-bits";

export function ClientAccountDialog({
  onCreated,
  label = "New client account",
  variant = "outline",
}: {
  onCreated?: (account: CreatedClientAccount) => void;
  label?: string;
  variant?: "outline" | "default" | "secondary";
}) {
  const [open, setOpen] = React.useState(false);
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [created, setCreated] = React.useState<CreatedClientAccount | null>(null);

  function reset() {
    setFullName("");
    setEmail("");
    setPhone("");
    setPassword("");
    setShow(false);
    setBusy(false);
    setError(null);
    setCreated(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const account = await api.admin.createClientAccount({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
      });
      setCreated(account);
      onCreated?.(account);
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not create that account"),
      );
    } finally {
      setBusy(false);
    }
  }

  const fieldErrors = error?.fieldErrors ?? {};

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        {label}
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <ModalContent
          title="New client account"
          description="Create a login for a client at the desk. The account can see its own bookings and passes."
        >
          {created ? (
            <div className="p-6 sm:p-7">
              <span className="flex size-11 items-center justify-center rounded-full bg-success/10 text-success">
                <CheckCircle2 className="size-5" />
              </span>
              <h2 className="mt-4 font-display text-[20px] font-semibold tracking-tight">
                Account created
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Hand these over — the guest signs in on the site with them.
              </p>

              <dl className="mt-5 space-y-3 rounded-xl border border-border/80 bg-sand-50 px-4 py-3.5">
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Email
                  </dt>
                  <dd className="mt-0.5 break-all text-[13.5px] font-medium">{created.email}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Password
                  </dt>
                  <dd className="mt-0.5 font-mono text-[13.5px]">{password}</dd>
                </div>
              </dl>

              <Button className="mt-5 w-full" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4 p-6 sm:p-7">
              <div>
                <p className="eyebrow-gold">The desk</p>
                <h2 className="mt-1.5 font-display text-[20px] font-semibold tracking-tight">
                  New client account
                </h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  If the client already exists from a past booking, the account is attached to
                  that record — their history stays in one place.
                </p>
              </div>

              {error && <ErrorNote error={error} />}

              <TextField
                label="Full name"
                placeholder="Ada Cruz"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                error={fieldErrors.fullName}
                autoComplete="name"
                required
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Email"
                  type="email"
                  placeholder="ada@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={fieldErrors.email}
                  autoComplete="off"
                  required
                />
                <TextField
                  label="Phone (optional)"
                  type="tel"
                  placeholder="+63 917 000 0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  error={fieldErrors.phone}
                  autoComplete="off"
                />
              </div>

              <div>
                <label
                  htmlFor="client-account-password"
                  className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Password
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="client-account-password"
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    className="h-10 w-full rounded-lg border border-border bg-card px-3 pr-11 text-[13.5px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {fieldErrors.password ? (
                  <p className="mt-1.5 text-[12px] text-clay">{fieldErrors.password}</p>
                ) : (
                  <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                    Set it here and read it to the guest — it is shown again once the account exists.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
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
              </div>
            </form>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
