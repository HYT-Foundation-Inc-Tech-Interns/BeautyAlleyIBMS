"use client";

/**
 * The built-in test gateway's hosted checkout.
 *
 * It looks and behaves like a payment provider's page: a reference, an amount,
 * and a pay/cancel decision. Behind it is a real database row and a **signed**
 * webhook — the same handler HitPay will use — so the deposit flow can be built
 * and tested before any merchant account is approved.
 *
 * It moves no money, writes nothing to a booking, and says TEST on every line.
 */

import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, FlaskConical, Loader2, XCircle } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { peso } from "@/lib/utils";
import { useAsync } from "@/lib/useAsync";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorNote, Loading } from "@/components/app/api-bits";

export default function DepositMock() {
  const [params] = useSearchParams();
  const reference = params.get("ref") || "";
  const fallbackAmount = Number(params.get("amount")) || 50000;
  const [busy, setBusy] = React.useState<"pay" | "cancel" | null>(null);
  const [error, setError] = React.useState<ApiError | null>(null);

  const payment = useAsync(`deposit:test:${reference}`, async () => {
    if (!reference) return null;
    return api.deposits.testPayment(reference);
  });

  async function act(action: "pay" | "cancel") {
    setBusy(action);
    setError(null);
    try {
      if (action === "pay") await api.deposits.payTest(reference);
      else await api.deposits.cancelTest(reference);
      payment.reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Could not settle this test payment."),
      );
    } finally {
      setBusy(null);
    }
  }

  const amountCents = payment.data?.amountCents ?? fallbackAmount;
  const status = payment.data?.status ?? "PENDING";

  return (
    <div className="flex min-h-screen items-center justify-center bg-sand-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border/80 bg-card p-7 shadow-soft">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-champagne-600">
          <FlaskConical className="size-3.5" />
          Test mode — no money moves
        </div>

        <h1 className="mt-3 font-display text-[26px] font-semibold tracking-tight">
          Deposit checkout
        </h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Reference <span className="font-mono text-[11.5px]">{reference || "(missing)"}</span>
        </p>

        <div className="mt-6 rounded-xl border border-border/70 bg-sand-50 px-5 py-5 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Amount
          </p>
          <p className="mt-1 font-display text-[32px] font-semibold text-primary">
            {peso(amountCents)}
          </p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">Built-in test gateway · PHP</p>
        </div>

        {!reference ? (
          <p className="mt-6 rounded-lg border border-clay/25 bg-clay/[0.04] px-4 py-3 text-[12.5px] text-clay">
            This link is missing its payment reference. Open a checkout from Settings → Deposits
            (test).
          </p>
        ) : payment.loading && !payment.data ? (
          <Loading label="Reading the test payment…" />
        ) : payment.error ? (
          <ErrorNote error={payment.error} onRetry={payment.reload} className="mt-6" />
        ) : (
          <>
            <div className="mt-5 flex items-center justify-between rounded-lg border border-border/70 px-4 py-3">
              <span className="text-[12px] text-muted-foreground">Status</span>
              <Badge
                variant={
                  status === "PAID" ? "success" : status === "CANCELLED" ? "destructive" : "warning"
                }
              >
                {status}
              </Badge>
            </div>

            {status === "PENDING" && (
              <div className="mt-6 space-y-3">
                <Button className="w-full" onClick={() => act("pay")} disabled={busy !== null}>
                  {busy === "pay" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  {busy === "pay" ? "Settling…" : "Pay now (test)"}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => act("cancel")}
                  disabled={busy !== null}
                >
                  <XCircle className="size-4" />
                  Cancel
                </Button>
              </div>
            )}

            {status !== "PENDING" && (
              <div className="mt-6 rounded-xl border border-border bg-muted/30 px-4 py-4">
                <p className="text-[14px] font-semibold">
                  {status === "PAID" ? "Simulated payment complete" : "Checkout cancelled"}
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  {status === "PAID"
                    ? "A signed webhook marked this test payment PAID. No money moved and no booking was changed."
                    : "This test payment is closed. Open a new checkout from Settings if you want another try."}
                </p>
              </div>
            )}

            {error && <ErrorNote error={error} className="mt-4" />}
          </>
        )}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
          The future HitPay webhook belongs at{" "}
          <span className="font-mono">/api/v1/webhooks/hitpay</span>. Until verification is
          complete, this built-in gateway needs no external account.
        </p>
      </div>
    </div>
  );
}
