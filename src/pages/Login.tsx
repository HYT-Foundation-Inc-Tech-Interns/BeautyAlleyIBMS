"use client";

import * as React from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { homeFor, useAuth } from "@/auth/AuthProvider";
import { BootScreen } from "@/auth/guards";
import { AuthAlert, AuthField, AuthLayout } from "@/components/app/AuthLayout";

/**
 * Sign in.
 *
 * The error handling is the interesting part. The API distinguishes four
 * failure modes that a user experiences completely differently, and collapsing
 * them into "login failed" would be a real usability loss:
 *
 *   INVALID_CREDENTIALS  a typo — stay on the form, keep the email
 *   ACCOUNT_LOCKED       wait it out — the message carries the minutes
 *   ACCOUNT_DISABLED     talk to the owner — retrying will never work
 *   VALIDATION_FAILED    the form itself is wrong
 *
 * So the code is branched on, and the API's own message is preferred over
 * anything invented here — it knows the lockout window.
 */
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, login } = useAuth();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);

  // Where to land afterwards. A guard that bounced us here leaves the intended
  // path in `state`, so a deep link survives the login round trip.
  const from = (location.state as { from?: string } | null)?.from;

  if (status === "loading") return <BootScreen label="Restoring your session…" />;
  if (status === "authenticated") return <Navigate to={from ?? "/app"} replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const profile = await login(email.trim(), password);
      navigate(from ?? homeFor(profile.role), { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Something went wrong. Try again."),
      );
      setSubmitting(false);
    }
  }

  const fieldErrors = error?.fieldErrors ?? {};

  return (
    <AuthLayout
      eyebrow="Sign in"
      title="Welcome back."
      lede="Your chair, your clients, today's run sheet — or your own appointments, if you're here for one."
      footer={
        /*
         * There is no "create one" link, because there is no public sign-up.
         * Accounts are made by an administrator; telling a visitor to ask at
         * the desk is both true and the shortest route to an account.
         */
        <>Accounts are created at the desk. Ask reception to set one up for you.</>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && (
          <AuthAlert
            tone={error.code === "ACCOUNT_LOCKED" ? "info" : "error"}
            title={
              error.code === "ACCOUNT_LOCKED"
                ? "Too many attempts"
                : error.code === "ACCOUNT_DISABLED"
                  ? "This account is not available"
                  : error.isNetwork
                    ? "Cannot reach the salon system"
                    : "That did not work"
            }
          >
            {error.message}
          </AuthAlert>
        )}

        <AuthField
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@beautyalley.ph"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          required
        />

        <AuthField
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          required
        />

        <Button type="submit" size="lg" className="h-11 w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Signing in…
            </>
          ) : (
            <>
              Sign in
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
