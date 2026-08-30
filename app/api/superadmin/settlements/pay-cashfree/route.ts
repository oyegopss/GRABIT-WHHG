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

const ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: "Access denied.",
  SETTLEMENT_NOT_FOUND: "Settlement not found.",
  SETTLEMENT_ALREADY_PAID: "This settlement has already been paid.",
  PAYOUT_ALREADY_PROCESSING: "A payout for this settlement is already processing.",
  PAYOUT_ALREADY_PAID: "This settlement was already paid via Cashfree Payouts.",
  INVALID_PAYOUT_AMOUNT: "Invalid payout amount.",
};

/**
 * Real Cashfree Payouts vendor payment — completely separate from the
 * manual "mark as paid with a bank reference" flow at
 * /api/superadmin/settlements/pay.
 *
 * Enforces strict idempotency, balance verification, and atomic state locking.
 */
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_TIERS } from "@/lib/security/rate_limit";

export async function POST(request: Request) {
  const ctx = await getAuthenticatedSuperAdminContext();
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "Access denied. Super Admin authorization required." }, { status: 403 });
  }

  const rateLimit = checkRateLimit(
    `payout-exec-admin:${ctx.user.id}`,
    RATE_LIMIT_TIERS.PAYOUT.limit,
    RATE_LIMIT_TIERS.PAYOUT.windowMs,
  );
  if (rateLimit.limited) {
    return createRateLimitResponse(rateLimit, "Payout rate limit reached. Please wait before triggering another payout.");
  }

  if (!isCashfreePayoutsConfigured()) {
    return NextResponse.json({ ok: false, error: "Cashfree Payouts is not configured.", code: "NOT_CONFIGURED" }, { status: 503 });
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canteen = settlement.canteens as any;

  if (settlement.status === "PAID") {
    return NextResponse.json({ ok: false, error: ERROR_MESSAGES.SETTLEMENT_ALREADY_PAID }, { status: 400 });
  }
  if (settlement.payout_status === "PROCESSING") {
    return NextResponse.json({ ok: false, error: ERROR_MESSAGES.PAYOUT_ALREADY_PROCESSING }, { status: 400 });
  }
  if (settlement.payout_status === "PAID") {
    return NextResponse.json({ ok: false, error: ERROR_MESSAGES.PAYOUT_ALREADY_PAID }, { status: 400 });
  }
  if (canteen?.payout_kyc_status !== "VERIFIED") {
    return NextResponse.json({ ok: false, error: "Vendor KYC/onboarding is not verified. Cannot pay out." }, { status: 400 });
  }
  const hasBankOrUpi = Boolean((canteen?.payout_bank_account_number && canteen?.payout_ifsc) || canteen?.payout_upi_id);
  if (!hasBankOrUpi) {
    return NextResponse.json({ ok: false, error: "Vendor has no bank account or UPI details on file." }, { status: 400 });
  }
  const amount = Number(settlement.payout_due);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: "Nothing due for this settlement." }, { status: 400 });
  }

  // Ensure beneficiary exists in Cashfree, or register it automatically
  let beneficiaryId = canteen?.payout_beneficiary_id as string | null;
  if (!beneficiaryId) {
    const generatedBeneId = `BENE_${(canteen?.id || settlement.canteen_id).replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    try {
      await addBeneficiary({
        beneficiaryId: generatedBeneId,
        name: canteen?.owner_name || canteen?.name || "Vendor Business",
        email: canteen?.email || "vendor@grabit.ventures",
        phone: canteen?.phone || "9999999999",
        bankAccount: canteen?.payout_bank_account_number,
        ifsc: canteen?.payout_ifsc,
        vpa: canteen?.payout_upi_id,
      });

      beneficiaryId = generatedBeneId;
      await admin
        .from("canteens")
        .update({ payout_beneficiary_id: generatedBeneId })
        .eq("id", settlement.canteen_id);
    } catch (beneErr) {
      console.warn("Beneficiary registration attempt with Cashfree returned:", beneErr instanceof Error ? beneErr.message : beneErr);
      // If Cashfree returns beneficiary already exists, reuse it
      beneficiaryId = generatedBeneId;
    }
  }

  try {
    const balance = await getPayoutsBalance();
    if (balance.availableBalance < amount) {
      return NextResponse.json({ ok: false, error: `Insufficient Cashfree balance. Available: ₹${balance.availableBalance.toFixed(2)}, Required: ₹${amount.toFixed(2)}.` }, { status: 400 });
    }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Cashfree Payouts balance check failed:", msg);
    return NextResponse.json({ ok: false, error: msg || "Could not verify Cashfree Payouts balance." }, { status: 502 });
  }

  const transferId = `GRABIT-PAYOUT-${randomUUID()}`;

  // Atomically locks the settlement (PENDING/FAILED → PROCESSING) and
  // records the intended transferId BEFORE any money moves.
  const { error: initErr } = await admin.rpc("initiate_vendor_payout", {
    p_settlement_id: settlementId,
    p_admin_id: ctx.user.id,
    p_cashfree_payout_id: transferId,
    p_beneficiary_id: beneficiaryId || "DEFAULT_BENE",
    p_amount: amount,
  });

  if (initErr) {
    const code = initErr.message?.split(":")[0]?.trim() ?? "";
    return NextResponse.json({ ok: false, error: ERROR_MESSAGES[code] ?? initErr.message ?? "Couldn't start payout." }, { status: 400 });
  }

  try {
    const transfer = await requestTransfer({
      transferId,
      beneficiaryId: beneficiaryId || "DEFAULT_BENE",
      amount,
      remarks: `GRABIT settlement ${settlementId.slice(0, 8)}`,
    });

    if (transfer.status === "SUCCESS") {
      await admin.rpc("confirm_vendor_payout", { p_cashfree_payout_id: transferId, p_status: "PAID" });
    } else if (transfer.status === "FAILED") {
      await admin.rpc("confirm_vendor_payout", {
        p_cashfree_payout_id: transferId,
        p_status: "FAILED",
        p_failure_reason: "Cashfree reported FAILED at initiation.",
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
    const msg = err instanceof Error ? err.message : "Transfer request failed.";
    console.error("Cashfree Payouts transfer failed:", msg);
    await admin.rpc("confirm_vendor_payout", {
      p_cashfree_payout_id: transferId,
      p_status: "FAILED",
      p_failure_reason: msg,
    });
    return NextResponse.json({ ok: false, error: `Payout initiation failed: ${msg}. No money was moved.` }, { status: 502 });
  }
}
