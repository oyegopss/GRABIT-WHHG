import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedSuperAdminContext } from "@/lib/supabase/superadmin";
import {
  isCashfreePayoutsConfigured,
  getPayoutsBalance,
  requestTransfer,
  addBeneficiary,
} from "@/lib/payments/cashfree_payouts";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Retries a previously FAILED Cashfree payout transfer for a settlement.
 * Strictly prevents retrying PAID or currently PROCESSING settlements.
 */
export async function POST(request: Request) {
  const ctx = await getAuthenticatedSuperAdminContext();
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "Access denied. Super Admin authorization required." }, { status: 403 });
  }

  if (!isCashfreePayoutsConfigured()) {
    return NextResponse.json({ ok: false, error: "Cashfree Payouts is not configured." }, { status: 503 });
  }

  const body = (await request.json()) as { settlementId?: unknown };
  const settlementId = typeof body.settlementId === "string" ? body.settlementId : null;
  if (!settlementId) {
    return NextResponse.json({ ok: false, error: "settlementId is required." }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();

  const { data: settlement, error: fetchErr } = await admin
    .from("vendor_settlements")
    .select("id, canteen_id, status, payout_status, payout_due, canteens(id, name, owner_name, payout_kyc_status, payout_beneficiary_id, payout_bank_account_number, payout_ifsc, payout_upi_id, phone, email)")
    .eq("id", settlementId)
    .maybeSingle();

  if (fetchErr || !settlement) {
    return NextResponse.json({ ok: false, error: "Settlement not found." }, { status: 404 });
  }

  if (settlement.status === "PAID" || settlement.payout_status === "PAID") {
    return NextResponse.json({ ok: false, error: "Settlement has already been paid. Cannot retry." }, { status: 400 });
  }

  if (settlement.payout_status === "PROCESSING") {
    return NextResponse.json({ ok: false, error: "A payout transfer is currently processing. Check status first." }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canteen = settlement.canteens as any;
  const amount = Number(settlement.payout_due);

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: "No payout due for this settlement." }, { status: 400 });
  }

  let beneficiaryId = canteen?.payout_beneficiary_id as string | null;
  if (!beneficiaryId) {
    beneficiaryId = `BENE_${(canteen?.id || settlement.canteen_id).replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    try {
      await addBeneficiary({
        beneficiaryId,
        name: canteen?.owner_name || canteen?.name || "Vendor Business",
        email: canteen?.email || "vendor@grabit.ventures",
        phone: canteen?.phone || "9999999999",
        bankAccount: canteen?.payout_bank_account_number,
        ifsc: canteen?.payout_ifsc,
      });
    } catch {
      // ignore if already exists
    }
  }

  try {
    const balance = await getPayoutsBalance();
    if (balance.availableBalance < amount) {
      return NextResponse.json({ ok: false, error: `Insufficient Cashfree balance for retry. Available: ₹${balance.availableBalance.toFixed(2)}, Required: ₹${amount.toFixed(2)}.` }, { status: 400 });
    }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg || "Could not verify Cashfree Payouts balance." }, { status: 502 });
  }

  const transferId = `GRABIT-PAYOUT-${randomUUID()}`;

  const { error: initErr } = await admin.rpc("initiate_vendor_payout", {
    p_settlement_id: settlementId,
    p_admin_id: ctx.user.id,
    p_cashfree_payout_id: transferId,
    p_beneficiary_id: beneficiaryId,
    p_amount: amount,
  });

  if (initErr) {
    return NextResponse.json({ ok: false, error: initErr.message || "Failed to initiate retry lock." }, { status: 400 });
  }

  try {
    const transfer = await requestTransfer({
      transferId,
      beneficiaryId,
      amount,
      remarks: `GRABIT retry ${settlementId.slice(0, 8)}`,
    });

    if (transfer.status === "SUCCESS") {
      await admin.rpc("confirm_vendor_payout", { p_cashfree_payout_id: transferId, p_status: "PAID" });
    } else if (transfer.status === "FAILED") {
      await admin.rpc("confirm_vendor_payout", {
        p_cashfree_payout_id: transferId,
        p_status: "FAILED",
        p_failure_reason: "Retry attempt reported FAILED.",
      });
    }

    return NextResponse.json({
      ok: true,
      settlementId,
      payoutStatus: transfer.status === "SUCCESS" ? "PAID" : transfer.status === "FAILED" ? "FAILED" : "PROCESSING",
      cashfreePayoutId: transferId,
      referenceId: transfer.referenceId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Retry transfer request failed.";
    await admin.rpc("confirm_vendor_payout", {
      p_cashfree_payout_id: transferId,
      p_status: "FAILED",
      p_failure_reason: msg,
    });
    return NextResponse.json({ ok: false, error: `Retry failed: ${msg}` }, { status: 502 });
  }
}
