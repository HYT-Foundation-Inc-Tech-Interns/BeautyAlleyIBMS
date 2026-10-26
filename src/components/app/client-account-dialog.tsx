"use client";

/**
 * The client's login, made or re-keyed at the desk.
 *
 * Two jobs, one dialog, because they are the same conversation at the counter:
 * "can I see my history?" and "I forgot my password". Both are things the
 * concierge handles without walking to the office.
 *
 * Creating is two writes (auth user, then the clients row that points at it);
 * resetting is one, addressed by the *client* id, because that is the record on
 * screen. The API refuses to reset anything that is not a CLIENT account, so a
 * concierge cannot reach an administrator's password through this door.
 *
 * No email is involved in either flow on purpose: the account is confirmed on
 * creation and the password is read out in person. A recovery link would need a
 * Site URL, and a link built from the wrong one is exactly how this system used
 * to send people to localhost.
 */

import * as React from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Search, UserPlus, X } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import type { ClientHit, CreatedClientAccount } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent } from "@/components/ui/modal";
import { ErrorNote, TextField } from "@/components/app/api-bits";

type Mode = "create" | "reset";

export function ClientAccountDialog({
  client,
  onChanged,
  label,
  variant = "outline",
}: {
  /** Pre-select a client (used from the Clients page). Omit to search for one. */
  client?: { id: string; fullName: string; email?: string | null };
  onChanged?: () => void;
  label?: string;
  variant?: "outline" | "default" | "secondary" | "ghost";
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>(client ? "reset" : "create");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [done, setDone] = React.useState<
    | { kind: "created"; account: CreatedClientAccount; password: string }
    | { kind: "reset"; fullName: string; password: string }
    | null
  >(null);

  /* create */
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);

  /* reset */
  const [term, setTerm] = React.useState("");
  const [hits, setHits] = React.useState<ClientHit[] | null>(null);
  const [target, setTarget] = React.useState<{ id: string; fullName: string } | null>(
    client ? { id: client.id, fullName: client.fullName } : null,
  );
  const [newPassword, setNewPassword] = React.useState("");
  const [showNew, setShowNew] = React.useState(false);

  function reset() {
    setMode(client ? "reset" : "create");
    setBusy(false);
    setError(null);
    setDone(null);
    setFullName("");
    setEmail("");
    setPhone("");
    setPassword("");
    setShow(false);
    setTerm("");
    setHits(null);
    setTarget(client ? { id: client.id, fullName: client.fullName } : null);
    setNewPassword("");
    setShowNew(false);
  }

  /* A keystroke should not spend a request; two characters is the API's floor. */
  React.useEffect(() => {
    if (!open || mode !== "reset" || target) return;
    const needle = term.trim();
    if (needle.length < 2) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      api.clients
        .search(needle)
        .then((rows) => setHits(rows))
        .catch(() => setHits([]));
    }, 280);
    return () => clearTimeout(timer);
  }, [term, open, mode, target]);

  async function createAccount(e: React.FormEvent) {
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
      setDone({ kind: "created", account, password });
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not create that account"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !target) return;
    setBusy(true);
    setError(null);
    try {
      await api.admin.resetClientPassword(target.id, newPassword);
      setDone({ kind: "reset", fullName: target.fullName, password: newPassword });
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not reset that password"),
      );
    } finally {
      setBusy(false);
    }
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const triggerLabel = label ?? (client ? "Reset password" : "Client account");

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {client ? <KeyRound className="size-4" /> : <UserPlus className="size-4" />}
        {triggerLabel}
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <ModalContent
          title={mode === "create" ? "New client account" : "Reset a client password"}
          description="Client logins only. Staff accounts are made by the administrator."
        >
          {done ? (
            <div className="p-6 sm:p-7">
              <span className="flex size-11 items-center justify-center rounded-full bg-success/10 text-success">
                <CheckCircle2 className="size-5" />
              </span>
              <h2 className="mt-4 font-display text-[20px] font-semibold tracking-tight">
                {done.kind === "created" ? "Account created" : "Password updated"}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {done.kind === "created"
                  ? "Hand these over — the guest signs in on the site with them."
                  : "Read the new password to " + done.fullName + " — the old one no longer works."}
              </p>

              <dl className="mt-5 space-y-3 rounded-xl border border-border/80 bg-sand-50 px-4 py-3.5">
                {done.kind === "created" ? (
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Email
                    </dt>
                    <dd className="mt-0.5 break-all text-[13.5px] font-medium">
                      {done.account.email}
                    </dd>
                  </div>
                ) : (
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Client
                    </dt>
                    <dd className="mt-0.5 text-[13.5px] font-medium">{done.fullName}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Password
                  </dt>
                  <dd className="mt-0.5 font-mono text-[13.5px]">{done.password}</dd>
                </div>
              </dl>

              <Button className="mt-5 w-full" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          ) : (
            <div className="p-6 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow-gold">The desk</p>
                  <h2 className="mt-1.5 font-display text-[20px] font-semibold tracking-tight">
                    {mode === "create" ? "New client account" : "Reset a client password"}
                  </h2>
                </div>
              </div>

              {/* Tabs are only offered when the dialog is not already pointed
                  at one client — from the Clients page it always is. */}
              {!client && (
                <div className="mt-4 flex rounded-full border border-border bg-muted/60 p-1">
                  {(["create", "reset"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setMode(option);
                        setError(null);
                      }}
                      aria-pressed={mode === option}
                      className={cn(
                        "flex-1 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
                        mode === option
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option === "create" ? "Create" : "Reset password"}
                    </button>
                  ))}
                </div>
              )}

              {error && <div className="mt-4"><ErrorNote error={error} /></div>}

              {mode === "create" ? (
                <form onSubmit={createAccount} className="mt-4 space-y-4">
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    If the client already exists from a past booking, the account is attached to
                    that record — their history stays in one place.
                  </p>

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

                  <PasswordField
                    id="client-account-password"
                    label="Password"
                    value={password}
                    onChange={setPassword}
                    show={show}
                    onToggle={() => setShow((v) => !v)}
                    error={fieldErrors.password}
                    hint="Set it here and read it to the guest — it is shown again once the account exists."
                  />

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
              ) : target ? (
                <form onSubmit={resetPassword} className="mt-4 space-y-4">
                  <div className="flex items-center gap-3 rounded-xl border border-border/80 bg-sand-50 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Client
                      </p>
                      <p className="mt-0.5 truncate text-[13.5px] font-medium">{target.fullName}</p>
                    </div>
                    {!client && (
                      <button
                        type="button"
                        onClick={() => {
                          setTarget(null);
                          setTerm("");
                          setHits(null);
                          setNewPassword("");
                        }}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label="Choose a different client"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>

                  <PasswordField
                    id="client-reset-password"
                    label="New password"
                    value={newPassword}
                    onChange={setNewPassword}
                    show={showNew}
                    onToggle={() => setShowNew((v) => !v)}
                    error={fieldErrors.password}
                    hint="The old password stops working immediately."
                  />

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={busy}>
                      {busy ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        <>
                          <KeyRound className="size-4" />
                          Set password
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
                    <input
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                      placeholder="Find the client by name, phone or email…"
                      aria-label="Find a client"
                      className="h-10 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-[13.5px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                    />
                  </div>

                  {hits === null ? (
                    <p className="px-1 py-3 text-[12.5px] text-muted-foreground">
                      Two characters is enough to start looking.
                    </p>
                  ) : hits.length === 0 ? (
                    <p className="px-1 py-3 text-[12.5px] text-muted-foreground">
                      No client matches that. They may not have a record yet — create an account
                      instead.
                    </p>
                  ) : (
                    <ul className="max-h-64 space-y-1 overflow-y-auto scroll-slim">
                      {hits.map((hit) => (
                        <li key={hit.id}>
                          <button
                            type="button"
                            onClick={() => setTarget({ id: hit.id, fullName: hit.fullName })}
                            className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-3.5 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.04]"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium">
                                {hit.fullName}
                              </span>
                              <span className="block truncate text-[11.5px] text-muted-foreground">
                                {hit.phone || hit.email || "—"}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}

/**
 * A password box with a show toggle.
 *
 * The person at the desk has to read this out loud, so hiding it behind dots
 * they cannot check is the wrong default — but leaving it in plain text on a
 * screen facing the queue is worse. Hence the toggle.
 */
function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggle,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
  error?: string;
  hint?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
      >
        {label}
      </label>
      <div className="relative mt-1.5">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          required
          minLength={8}
          className="h-10 w-full rounded-lg border border-border bg-card px-3 pr-11 text-[13.5px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error ? (
        <p className="mt-1.5 text-[12px] text-clay">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
