import { NextResponse } from "next/server";
import { getAuthenticatedSuperAdminContext } from "@/lib/supabase/superadmin";
import { isCashfreePayoutsConfigured, getTransferStatus } from "@/lib/payments/cashfree_payouts";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Polls and refreshes the real-time status of a Cashfree payout transfer for a settlement.
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
    .select("id, status, payout_status, cashfree_payout_id, payout_amount, payout_due")
    .eq("id", settlementId)
    .maybeSingle();

  if (fetchErr || !settlement) {
    return NextResponse.json({ ok: false, error: "Settlement not found." }, { status: 404 });
  }

  const cashfreePayoutId = settlement.cashfree_payout_id;
  if (!cashfreePayoutId) {
    return NextResponse.json({
      ok: true,
      settlementId,
      payoutStatus: settlement.payout_status || "PENDING",
      message: "No Cashfree payout has been initiated for this settlement yet.",
    });
  }

  try {
    const statusResult = await getTransferStatus(cashfreePayoutId);

    if (statusResult.status === "SUCCESS" && settlement.payout_status !== "PAID") {
      await admin.rpc("confirm_vendor_payout", {
        p_cashfree_payout_id: cashfreePayoutId,
        p_status: "PAID",
      });
    } else if (statusResult.status === "FAILED" && settlement.payout_status !== "FAILED") {
      await admin.rpc("confirm_vendor_payout", {
        p_cashfree_payout_id: cashfreePayoutId,
        p_status: "FAILED",
        p_failure_reason: `Cashfree status: ${statusResult.rawStatus}`,
      });
    }

    return NextResponse.json({
      ok: true,
      settlementId,
      cashfreePayoutId,
      payoutStatus: statusResult.status,
      referenceId: statusResult.referenceId,
      utr: statusResult.utr,
    });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to fetch Cashfree transfer status:", msg);
    return NextResponse.json({
      ok: false,
      error: `Could not fetch transfer status from Cashfree: ${msg}`,
    }, { status: 502 });
  }
}
