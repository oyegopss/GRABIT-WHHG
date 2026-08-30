"use client";

import React, { useState, useEffect, useCallback } from "react";

interface CanteenOption {
  id: string;
  name: string;
}

interface VendorSettlementItem {
  id: string;
  canteen_id: string;
  settlement_date: string;
  window_start: string;
  window_end: string;
  total_orders: number;
  gross_revenue: number;
  commission_rate: number;
  commission_amount: number;
  payout_amount: number;
  already_paid_amount: number;
  payout_due: number;
  cancelled_orders_count: number;
  cancelled_orders_amount: number;
  telegram_message_id: string | null;
  telegram_sent_at: string | null;
  status: "PENDING" | "PAID" | "PARTIALLY_PAID";
  payment_reference: string | null;
  paid_at: string | null;
  payout_status?: "PENDING" | "PROCESSING" | "PAID" | "FAILED" | "REVERSED" | null;
  cashfree_payout_id?: string | null;
  payout_failure_reason?: string | null;
  canteens?: {
    name: string;
    owner_name?: string | null;
    payout_bank_account_number?: string | null;
    payout_ifsc?: string | null;
    payout_kyc_status?: string | null;
  };
}

export default function SuperAdminSettlementsPage() {
  const [settlements, setSettlements] = useState<VendorSettlementItem[]>([]);
  const [canteens, setCanteens] = useState<CanteenOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filter State
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedCanteen, setSelectedCanteen] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  // Manual Mark as Paid Modal State
  const [activeSettlement, setActiveSettlement] = useState<VendorSettlementItem | null>(null);
  const [payAmount, setPayAmount] = useState<string>("");
  const [payReference, setPayReference] = useState<string>("");
  const [isSubmittingPay, setIsSubmittingPay] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Cashfree Payout Confirmation Modal State
  const [cashfreeConfirmTarget, setCashfreeConfirmTarget] = useState<VendorSettlementItem | null>(null);
  const [isProcessingCashfree, setIsProcessingCashfree] = useState(false);
  const [cashfreeActionError, setCashfreeActionError] = useState<string | null>(null);

  // Manual Trigger State
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Cashfree Payouts Configuration & Processing State
  const [payoutsConfigured, setPayoutsConfigured] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const reloadSettlements = useCallback(() => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (selectedDate) params.set("date", selectedDate);
    if (selectedCanteen !== "ALL") params.set("canteen_id", selectedCanteen);
    if (selectedStatus !== "ALL") params.set("status", selectedStatus);

    fetch(`/api/superadmin/settlements?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setSettlements(data.settlements || []);
          if (data.canteens) setCanteens(data.canteens);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch settlements:", err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [selectedDate, selectedCanteen, selectedStatus]);

  useEffect(() => {
    fetch("/api/superadmin/cashfree-payouts")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setPayoutsConfigured(data.configured && data.connectionStatus === "CONNECTED");
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let isMounted = true;
    const params = new URLSearchParams();
    if (selectedDate) params.set("date", selectedDate);
    if (selectedCanteen !== "ALL") params.set("canteen_id", selectedCanteen);
    if (selectedStatus !== "ALL") params.set("status", selectedStatus);

    fetch(`/api/superadmin/settlements?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && data.ok) {
          setSettlements(data.settlements || []);
          if (data.canteens) setCanteens(data.canteens);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch settlements:", err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedDate, selectedCanteen, selectedStatus]);

  const handleGenerateSettlements = async () => {
    setIsGenerating(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/superadmin/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate || undefined, sendTelegram: true }),
      });
      const data = await res.json();
      setIsGenerating(false);

      if (res.ok && data.ok) {
        setStatusMsg(
          `Settlements calculated for ${data.displayDate}. Sent ${data.telegramSentCount} Telegram message(s).`,
        );
        reloadSettlements();
      } else {
        setStatusMsg(data.error || "Failed to generate settlements.");
      }
    } catch {
      setIsGenerating(false);
      setStatusMsg("Network error generating settlements.");
    }
  };

  const handleExecuteCashfreePayout = async () => {
    if (!cashfreeConfirmTarget) return;
    setIsProcessingCashfree(true);
    setCashfreeActionError(null);

    try {
      const isRetry = cashfreeConfirmTarget.payout_status === "FAILED";
      const endpoint = isRetry
        ? "/api/superadmin/settlements/pay-cashfree/retry"
        : "/api/superadmin/settlements/pay-cashfree";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settlementId: cashfreeConfirmTarget.id }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setCashfreeActionError(data.error || "Cashfree payout transfer failed.");
      } else {
        setCashfreeConfirmTarget(null);
        setStatusMsg(`Cashfree payout transfer ${data.payoutStatus === "PAID" ? "completed successfully" : "is processing"} (Ref: ${data.cashfreePayoutId || data.referenceId}).`);
        reloadSettlements();
      }
    } catch {
      setCashfreeActionError("Network error communicating with Cashfree Payouts API.");
    } finally {
      setIsProcessingCashfree(false);
    }
  };

  const handleRefreshPayoutStatus = async (settlementId: string) => {
    setRefreshingId(settlementId);
    try {
      const res = await fetch("/api/superadmin/settlements/pay-cashfree/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settlementId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setStatusMsg(`Payout status refreshed: ${data.payoutStatus}.`);
        reloadSettlements();
      } else {
        setStatusMsg(data.error || "Failed to refresh payout status.");
      }
    } catch {
      setStatusMsg("Network error checking transfer status.");
    } finally {
      setRefreshingId(null);
    }
  };

  const handleOpenPayModal = (item: VendorSettlementItem) => {
    setActiveSettlement(item);
    setPayAmount(String(item.payout_due || item.payout_amount));
    setPayReference("");
    setPayError(null);
  };

  const handleConfirmPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSettlement) return;

    const numericAmount = Number(payAmount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setPayError("Please enter a valid payout amount.");
      return;
    }

    if (!payReference.trim()) {
      setPayError("Payment reference / transaction ID is required.");
      return;
    }

    setIsSubmittingPay(true);
    setPayError(null);

    try {
      const res = await fetch("/api/superadmin/settlements/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settlementId: activeSettlement.id,
          paidAmount: numericAmount,
          paymentReference: payReference.trim(),
        }),
      });

      const data = await res.json();
      setIsSubmittingPay(false);

      if (res.ok && data.ok) {
        setActiveSettlement(null);
        setStatusMsg(`Payment recorded! Sent Telegram confirmation to Super Admin.`);
        reloadSettlements();
      } else {
        setPayError(data.error || "Failed to record payment.");
      }
    } catch {
      setIsSubmittingPay(false);
      setPayError("Network error recording payment.");
    }
  };

  // Metrics summary calculations
  const totalRevenue = settlements.reduce((acc, s) => acc + Number(s.gross_revenue || 0), 0);
  const totalCommission = settlements.reduce((acc, s) => acc + Number(s.commission_amount || 0), 0);
  const totalPayoutDue = settlements.reduce((acc, s) => acc + Number(s.payout_due || 0), 0);
  const pendingCount = settlements.filter((s) => s.status === "PENDING").length;

  return (
    <div className="min-h-dvh bg-background p-4 sm:p-8 text-foreground space-y-6">
      {/* Header Title */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[28px] text-primary">payments</span>
            <h1 className="font-display text-2xl font-black tracking-tight text-foreground sm:text-3xl">
              Vendor Settlements
            </h1>
          </div>
          <p className="mt-1 font-body text-caption text-muted">
            Automated daily vendor settlements with instant Cashfree Payouts transfer and Telegram alerts.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <a
            href="/superadmin/cashfree-payouts"
            className="inline-flex items-center gap-2 rounded-2xl border border-border bg-surface-elevated px-4 py-2.5 font-display text-caption font-bold text-foreground hover:bg-surface-elevated/80 transition-all"
          >
            <span className="material-symbols-outlined text-[18px] text-primary">account_balance_wallet</span>
            <span>Cashfree Payouts Account</span>
          </a>

          <button
            type="button"
            disabled={isGenerating}
            onClick={handleGenerateSettlements}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 font-display text-caption font-bold text-on-primary shadow-glow-primary hover:opacity-90 active:scale-95 disabled:opacity-50 transition-all"
          >
            <span
              className={`material-symbols-outlined text-[18px] ${
                isGenerating ? "animate-spin" : ""
              }`}
            >
              {isGenerating ? "progress_activity" : "send"}
            </span>
            <span>{isGenerating ? "Processing..." : "Run 6 PM Settlement"}</span>
          </button>
        </div>
      </div>

      {/* Status Notification Banner */}
      {statusMsg && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-body-sm font-semibold text-primary">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">info</span>
            <span>{statusMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="text-primary hover:text-white"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Metrics Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface-elevated p-4">
          <p className="font-display text-caption font-bold uppercase tracking-wider text-muted">
            Gross Revenue
          </p>
          <p className="mt-1 font-display text-2xl font-black text-foreground">
            ₹{totalRevenue.toLocaleString("en-IN")}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface-elevated p-4">
          <p className="font-display text-caption font-bold uppercase tracking-wider text-muted">
            GRABIT Commission (₹1/order)
          </p>
          <p className="mt-1 font-display text-2xl font-black text-primary">
            ₹{totalCommission.toLocaleString("en-IN")}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface-elevated p-4">
          <p className="font-display text-caption font-bold uppercase tracking-wider text-muted">
            Payout Due
          </p>
          <p className="mt-1 font-display text-2xl font-black text-warning">
            ₹{totalPayoutDue.toLocaleString("en-IN")}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface-elevated p-4">
          <p className="font-display text-caption font-bold uppercase tracking-wider text-muted">
            Pending Settlements
          </p>
          <p className="mt-1 font-display text-2xl font-black text-foreground">
            {pendingCount} vendor(s)
          </p>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface-elevated p-4">
        <div>
          <label htmlFor="settlement-date" className="mb-1 block font-display text-caption font-bold text-muted">
            Date Filter
          </label>
          <input
            id="settlement-date"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-1.5 text-body-sm text-foreground focus:border-primary focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="settlement-canteen" className="mb-1 block font-display text-caption font-bold text-muted">
            Vendor Store
          </label>
          <select
            id="settlement-canteen"
            value={selectedCanteen}
            onChange={(e) => setSelectedCanteen(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-1.5 text-body-sm text-foreground focus:border-primary focus:outline-none"
          >
            <option value="ALL">All Vendors</option>
            {canteens.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="settlement-status" className="mb-1 block font-display text-caption font-bold text-muted">
            Status
          </label>
          <select
            id="settlement-status"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-1.5 text-body-sm text-foreground focus:border-primary focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="PAID">Paid</option>
          </select>
        </div>

        {(selectedDate || selectedCanteen !== "ALL" || selectedStatus !== "ALL") && (
          <button
            type="button"
            onClick={() => {
              setSelectedDate("");
              setSelectedCanteen("ALL");
              setSelectedStatus("ALL");
            }}
            className="mt-5 font-display text-caption font-bold text-primary hover:underline"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Settlements Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-primary">
            <span className="material-symbols-outlined animate-spin text-[32px]">
              progress_activity
            </span>
          </div>
        ) : settlements.length === 0 ? (
          <div className="p-12 text-center text-muted space-y-2">
            <span className="material-symbols-outlined text-[40px] text-faint">payments</span>
            <p className="font-display text-body font-bold">No settlements found for selected criteria.</p>
            <p className="font-body text-caption text-faint">
              Click &quot;Run 6 PM Settlement&quot; to calculate current settlements.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface-elevated font-display text-caption font-bold uppercase tracking-wider text-muted">
                  <th className="px-4 py-3">Vendor / Store</th>
                  <th className="px-4 py-3">Bank Details</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-center">Orders</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">Payout Due</th>
                  <th className="px-4 py-3 text-center">Telegram</th>
                  <th className="px-4 py-3 text-center">Payout Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-body text-body-sm">
                {settlements.map((s) => {
                  const canteenName = s.canteens?.name || "Vendor";
                  const isPaid = s.status === "PAID" || s.payout_status === "PAID";
                  const isProcessing = s.payout_status === "PROCESSING";
                  const isFailed = s.payout_status === "FAILED";
                  const rawAcc = (s.canteens?.payout_bank_account_number || "").trim();
                  const maskedAcc = rawAcc.length >= 4 ? `•••• ${rawAcc.slice(-4)}` : "—";
                  const ifsc = s.canteens?.payout_ifsc || "—";

                  return (
                    <tr key={s.id} className="hover:bg-surface-elevated/50 transition-colors">
                      <td className="px-4 py-3.5 font-display font-bold text-foreground">
                        <div>{canteenName}</div>
                        {s.canteens?.owner_name && (
                          <div className="text-[11px] font-normal text-muted truncate max-w-[140px]">
                            {s.canteens.owner_name}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-body-xs font-mono">
                        <div className="font-bold text-foreground">{maskedAcc}</div>
                        <div className="text-[11px] text-faint">{ifsc}</div>
                      </td>
                      <td className="px-4 py-3.5 text-muted">
                        <div className="font-bold text-foreground">{s.settlement_date}</div>
                        <div className="text-[11px] text-faint">8 AM – 6 PM</div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className="font-bold text-foreground">{s.total_orders}</span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold text-foreground">
                        ₹{Number(s.gross_revenue).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-warning">
                        ₹{Number(s.payout_due).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {s.telegram_message_id ? (
                          <span className="inline-flex items-center text-success" title={`Msg ID: ${s.telegram_message_id}`}>
                            <span className="material-symbols-outlined text-[18px]">check_circle</span>
                          </span>
                        ) : (
                          <span className="text-faint text-[11px]">Not Sent</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isPaid ? (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/15 px-2.5 py-0.5 font-display text-[10px] font-extrabold uppercase text-success">
                              <span className="material-symbols-outlined text-[12px]">done_all</span>
                              PAID
                            </span>
                            {s.payment_reference && (
                              <div className="text-[10px] font-mono text-faint mt-0.5 truncate max-w-[110px]" title={s.payment_reference}>
                                {s.payment_reference}
                              </div>
                            )}
                          </div>
                        ) : isProcessing ? (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/15 px-2.5 py-0.5 font-display text-[10px] font-extrabold uppercase text-primary">
                              <span className="material-symbols-outlined animate-spin text-[12px]">sync</span>
                              PROCESSING
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRefreshPayoutStatus(s.id)}
                              disabled={refreshingId === s.id}
                              className="mt-1 block mx-auto text-[10px] text-primary underline hover:text-white"
                            >
                              {refreshingId === s.id ? "Checking..." : "Refresh"}
                            </button>
                          </div>
                        ) : isFailed ? (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/15 px-2.5 py-0.5 font-display text-[10px] font-extrabold uppercase text-danger" title={s.payout_failure_reason || "Payout failed"}>
                              <span className="material-symbols-outlined text-[12px]">error</span>
                              FAILED
                            </span>
                            <button
                              type="button"
                              onClick={() => setCashfreeConfirmTarget(s)}
                              className="mt-1 block mx-auto text-[10px] font-bold text-danger underline hover:text-white"
                            >
                              Retry Payout
                            </button>
                          </div>
                        ) : (
                          <span className="inline-flex rounded-full border border-warning/30 bg-warning/15 px-2.5 py-0.5 font-display text-[10px] font-extrabold uppercase text-warning">
                            PENDING
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {isPaid ? (
                          <span className="font-display text-caption font-semibold text-muted">Settled</span>
                        ) : isProcessing ? (
                          <button
                            type="button"
                            onClick={() => handleRefreshPayoutStatus(s.id)}
                            disabled={refreshingId === s.id}
                            className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-1.5 font-display text-caption font-bold text-primary hover:bg-primary/20 transition-all"
                          >
                            {refreshingId === s.id ? "Checking…" : "Check Status"}
                          </button>
                        ) : isFailed ? (
                          <button
                            type="button"
                            onClick={() => setCashfreeConfirmTarget(s)}
                            className="rounded-xl bg-danger px-3 py-1.5 font-display text-caption font-bold text-white hover:opacity-90 transition-all"
                          >
                            Retry Cashfree
                          </button>
                        ) : (
                          <div className="flex flex-col items-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setCashfreeConfirmTarget(s)}
                              className="rounded-xl bg-primary px-3 py-1.5 font-display text-caption font-bold text-on-primary shadow-glow-primary hover:opacity-90 active:scale-95 transition-all"
                            >
                              Pay via Cashfree
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenPayModal(s)}
                              className="rounded-xl border border-border-subtle px-3 py-1 font-display text-[11px] font-semibold text-muted hover:text-foreground"
                            >
                              Manual Pay
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cashfree Payout Confirmation Modal */}
      {cashfreeConfirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl border border-primary/40 bg-surface-elevated p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[24px] text-primary">account_balance_wallet</span>
                <h3 className="font-display text-title font-bold text-foreground">
                  Confirm Cashfree Payout
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCashfreeConfirmTarget(null)}
                className="text-faint hover:text-foreground"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-4 space-y-2 text-body-sm">
              <div className="flex justify-between">
                <span className="text-muted">Vendor Store:</span>
                <strong className="text-foreground">{cashfreeConfirmTarget.canteens?.name || "Vendor"}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Account Holder:</span>
                <strong className="text-foreground">{cashfreeConfirmTarget.canteens?.owner_name || cashfreeConfirmTarget.canteens?.name || "—"}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Bank Account:</span>
                <strong className="font-mono text-foreground">{cashfreeConfirmTarget.canteens?.payout_bank_account_number ? `•••• ${cashfreeConfirmTarget.canteens.payout_bank_account_number.slice(-4)}` : "Not Configured"}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">IFSC Code:</span>
                <strong className="font-mono text-foreground">{cashfreeConfirmTarget.canteens?.payout_ifsc || "—"}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Settlement Date:</span>
                <strong className="text-foreground">{cashfreeConfirmTarget.settlement_date}</strong>
              </div>
              <div className="flex justify-between border-t border-border pt-2">
                <span className="text-muted font-bold">Payout Amount:</span>
                <strong className="text-xl font-black text-warning">₹{Number(cashfreeConfirmTarget.payout_due).toLocaleString("en-IN")}</strong>
              </div>
            </div>

            <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-caption font-semibold text-warning">
              ⚠️ This will execute an electronic money transfer through Cashfree Payouts.
            </div>

            {cashfreeActionError && (
              <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-caption font-semibold text-danger">
                {cashfreeActionError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCashfreeConfirmTarget(null)}
                className="flex-1 rounded-xl border border-border py-2.5 font-display text-caption font-bold text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isProcessingCashfree}
                onClick={handleExecuteCashfreePayout}
                className="flex-1 rounded-xl bg-primary py-2.5 font-display text-caption font-bold text-on-primary shadow-glow-primary hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {isProcessingCashfree ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                    Transferring...
                  </>
                ) : (
                  "Confirm & Transfer"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Mark as Paid Modal */}
      {activeSettlement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl border border-border bg-surface-elevated p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-display text-title font-bold text-foreground">
                Record Manual Payment
              </h3>
              <button
                type="button"
                onClick={() => setActiveSettlement(null)}
                className="text-faint hover:text-foreground"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-1 text-body-sm">
              <p className="text-muted">
                Vendor: <strong className="text-foreground">{activeSettlement.canteens?.name || "Vendor"}</strong>
              </p>
              <p className="text-muted">
                Settlement Date: <strong className="text-foreground">{activeSettlement.settlement_date}</strong>
              </p>
              <p className="text-muted">
                Payout Due: <strong className="text-warning">₹{activeSettlement.payout_due}</strong>
              </p>
            </div>

            {payError && (
              <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-caption font-semibold text-danger">
                {payError}
              </div>
            )}

            <form onSubmit={handleConfirmPay} className="space-y-4">
              <div>
                <label htmlFor="pay-amount" className="mb-1 block font-display text-caption font-bold text-muted">
                  Paid Amount (₹)
                </label>
                <input
                  id="pay-amount"
                  type="number"
                  step="0.01"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-body-sm text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="pay-ref" className="mb-1 block font-display text-caption font-bold text-muted">
                  Payment Reference / Bank UTR
                </label>
                <input
                  id="pay-ref"
                  type="text"
                  required
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                  placeholder="e.g. UTR-98234710293"
                  className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-body-sm text-foreground focus:border-primary focus:outline-none placeholder:text-faint"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveSettlement(null)}
                  className="flex-1 rounded-xl border border-border py-2.5 font-display text-caption font-bold text-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPay}
                  className="flex-1 rounded-xl bg-primary py-2.5 font-display text-caption font-bold text-on-primary shadow-glow-primary hover:opacity-90 disabled:opacity-50"
                >
                  {isSubmittingPay ? "Confirming..." : "Record Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
