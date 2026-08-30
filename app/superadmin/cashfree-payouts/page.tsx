"use client";

import { useCallback, useEffect, useState } from "react";

interface PayoutsStatus {
  ok: boolean;
  configured: boolean;
  connected: boolean;
  connectionStatus: "NOT_CONFIGURED" | "CONNECTED" | "ERROR";
  availableBalance?: number;
  fundSource?: string | null;
  syncedAt?: string;
  error?: string;
  detectedIp?: string | null;
  isIpWhitelistingRequired?: boolean;
}

export default function CashfreePayoutsPage() {
  const [status, setStatus] = useState<PayoutsStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedIp, setCopiedIp] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/superadmin/cashfree-payouts");
      const data = await res.json();
      if (data.ok) setStatus(data);
    } catch {
      setStatus({
        ok: false,
        configured: true,
        connected: false,
        connectionStatus: "ERROR",
        error: "Network error communicating with server.",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copyIpToClipboard = (ip: string) => {
    navigator.clipboard.writeText(ip);
    setCopiedIp(true);
    setTimeout(() => setCopiedIp(false), 3000);
  };

  return (
    <main className="min-h-dvh bg-background p-4 text-foreground md:p-8 space-y-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[32px] text-primary">account_balance_wallet</span>
              <h1 className="font-display text-heading-lg font-900 tracking-tight text-foreground">
                Cashfree Payouts Account
              </h1>
            </div>
            <p className="mt-1 text-body-sm text-muted">
              Live Cashfree Payouts fund source used to transfer daily settlements to vendor bank accounts.
            </p>
          </div>

          <div className="flex gap-2">
            <a
              href="/superadmin/settlements"
              className="rounded-2xl border border-border bg-surface px-4 py-2.5 font-display text-caption font-bold text-foreground hover:bg-surface-elevated transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">receipt_long</span>
              View Settlements
            </a>
            <button
              type="button"
              onClick={load}
              disabled={isLoading}
              className="rounded-2xl bg-primary px-4 py-2.5 font-display text-caption font-bold text-on-primary shadow-glow-primary hover:opacity-90 active:scale-95 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              <span className={`material-symbols-outlined text-[18px] ${isLoading ? "animate-spin" : ""}`}>
                sync
              </span>
              Refresh Balance
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-surface-elevated" />
            ))}
          </div>
        ) : status?.connectionStatus === "NOT_CONFIGURED" ? (
          <section className="rounded-3xl border border-warning/40 bg-warning/5 p-6 space-y-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[24px] text-warning">warning</span>
              <p className="font-display text-body font-800 text-warning">Cashfree Payouts: NOT CONFIGURED</p>
            </div>
            <p className="text-body-sm text-muted">
              No server-side credentials (<code className="font-mono text-foreground">CASHFREE_PAYOUTS_CLIENT_ID</code> / <code className="font-mono text-foreground">CASHFREE_PAYOUTS_CLIENT_SECRET</code>) are configured on the server.
            </p>
          </section>
        ) : status?.connectionStatus === "ERROR" ? (
          <div className="space-y-6">
            <section className="rounded-3xl border border-danger/40 bg-danger/10 p-6 space-y-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[24px] text-danger">gpp_maybe</span>
                <p className="font-display text-body font-800 text-danger">Cashfree Payouts: IP Whitelisting Required</p>
              </div>
              <p className="text-body-sm text-foreground/90">
                {status.error}
              </p>

              {status.detectedIp && (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-danger/30 bg-surface p-4">
                  <div>
                    <p className="text-caption text-muted">Detected Server IP Address:</p>
                    <p className="font-mono text-lg font-bold text-foreground">{status.detectedIp}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyIpToClipboard(status.detectedIp!)}
                    className="ml-auto rounded-xl bg-danger px-3 py-1.5 font-display text-caption font-bold text-white hover:opacity-90 transition-all flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">{copiedIp ? "check" : "content_copy"}</span>
                    {copiedIp ? "Copied!" : "Copy IP"}
                  </button>
                </div>
              )}

              <div className="text-caption text-muted space-y-1">
                <p className="font-bold text-foreground">How to whitelist this IP in Cashfree:</p>
                <ol className="list-decimal pl-5 space-y-0.5">
                  <li>Log in to <a href="https://merchant.cashfree.com/merchants/login" target="_blank" rel="noreferrer" className="text-primary underline">Cashfree Merchant Dashboard</a>.</li>
                  <li>Navigate to <strong>Payouts</strong> &rarr; <strong>Developers</strong> &rarr; <strong>IP Whitelist</strong>.</li>
                  <li>Add IP: <code className="font-mono font-bold text-foreground">{status.detectedIp || "Your Server IP"}</code>.</li>
                  <li>Click <strong>Refresh Balance</strong> above to verify connection.</li>
                </ol>
              </div>
            </section>
          </div>
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-3xl border border-success/30 bg-success/5 p-6">
              <div className="flex items-center justify-between">
                <p className="text-label font-bold uppercase text-muted">API Status</p>
                <span className="material-symbols-outlined text-[20px] text-success">verified</span>
              </div>
              <p className="mt-2 font-display text-2xl font-black text-success">CONNECTED</p>
              <p className="mt-1 text-[11px] text-muted">Cashfree Sandbox Live</p>
            </div>

            <div className="rounded-3xl border border-border bg-surface-elevated p-6">
              <div className="flex items-center justify-between">
                <p className="text-label font-bold uppercase text-muted">Available Balance</p>
                <span className="material-symbols-outlined text-[20px] text-primary">account_balance</span>
              </div>
              <p className="mt-2 font-display text-2xl font-black text-foreground">
                ₹{(status?.availableBalance ?? 0).toLocaleString("en-IN")}
              </p>
              <p className="mt-1 text-[11px] text-muted">Available for instant transfers</p>
            </div>

            <div className="rounded-3xl border border-border bg-surface-elevated p-6">
              <div className="flex items-center justify-between">
                <p className="text-label font-bold uppercase text-muted">Fund Source</p>
                <span className="material-symbols-outlined text-[20px] text-muted">account_tree</span>
              </div>
              <p className="mt-2 font-display text-xl font-bold text-foreground truncate">
                {status?.fundSource ?? "STANDARD"}
              </p>
              <p className="mt-1 text-[11px] text-muted">Cashfree Payouts Gateway</p>
            </div>

            <div className="rounded-3xl border border-border bg-surface-elevated p-6">
              <div className="flex items-center justify-between">
                <p className="text-label font-bold uppercase text-muted">Last Synced</p>
                <span className="material-symbols-outlined text-[20px] text-muted">schedule</span>
              </div>
              <p className="mt-2 font-display text-base font-bold text-foreground">
                {status?.syncedAt ? new Date(status.syncedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
              </p>
              <p className="mt-1 text-[11px] text-muted">Real-time external check</p>
            </div>
          </section>
        )}

        {/* Integration Architecture Documentation Section */}
        <section className="rounded-3xl border border-border bg-surface p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">shield</span>
            Financial Safety & Idempotency Rules
          </h2>
          <div className="grid gap-4 md:grid-cols-3 text-body-sm">
            <div className="rounded-2xl border border-border/60 bg-surface-elevated p-4 space-y-1.5">
              <p className="font-bold text-foreground">1. Source of Truth</p>
              <p className="text-caption text-muted">
                The GRABIT Financial Ledger is the source of truth for internal accounting. Cashfree is the external money execution provider.
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-surface-elevated p-4 space-y-1.5">
              <p className="font-bold text-foreground">2. Strict Idempotency</p>
              <p className="text-caption text-muted">
                Each transfer uses a unique <code className="font-mono text-foreground">GRABIT-PAYOUT-UUID</code> reference and atomic database locks to eliminate duplicate payments.
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-surface-elevated p-4 space-y-1.5">
              <p className="font-bold text-foreground">3. Webhook Signature</p>
              <p className="text-caption text-muted">
                Status transitions only occur after HMAC-SHA256 signature verification and webhook deduplication.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
