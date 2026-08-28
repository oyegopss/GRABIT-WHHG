import { NextResponse } from "next/server";
import { getAuthenticatedVendorContext } from "@/lib/supabase/vendor_auth";
import { getInventoryLogsForCanteen } from "@/lib/vendor/inventoryStore";

export async function GET() {
  try {
    const vendorCtx = await getAuthenticatedVendorContext();
    if (!vendorCtx) {
      return NextResponse.json(
        { ok: false, error: "Access denied. Please sign in with a vendor account." },
        { status: 401 },
      );
    }

    const logs = getInventoryLogsForCanteen(vendorCtx.canteenId);

    const formattedLogs = logs.map((log) => ({
      id: log.id,
      menu_item_id: log.menuItemId,
      previous_quantity: log.previousQuantity,
      new_quantity: log.newQuantity,
      quantity_changed: log.quantityChanged,
      adjustment_type: log.adjustmentType,
      reason: log.reason,
      created_at: log.createdAt,
      menu_items: {
        name: log.menuItemName,
      },
    }));

    return NextResponse.json({ ok: true, logs: formattedLogs });
  } catch (err) {
    console.error("Vendor inventory history GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error." },
      { status: 500 },
    );
  }
}
